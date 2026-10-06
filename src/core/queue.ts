import { getConfig } from './config.js'
import { getVideoById, searchSongs, selectBestSong } from '../integrations/youtube/index.js'
import { parseYouTubeUrl } from '../integrations/youtube/url.js'
import { logRejection, logAcceptance } from './activity.js'
import { QueueItem, Song, AppError, AddedSong, FailureReason } from './types.js'
import { isBlocked } from './blocklist.js'
import { emit } from '../infra/state-events.js'
import { finishItem } from './finish.js'
import { createLogger, describeError } from '../infra/logger.js'

let currentSong: QueueItem | null = null
const queue: QueueItem[] = []

let isPaused = false

const log = createLogger('QUEUE')

// Everything below is derived from `queue` on demand, so there is no second copy that could drift apart from it
const isQueued = (videoId: string): boolean => queue.some((item) => item.videoId === videoId)

function getUserActiveCount(username: string): number {
  const key = username.toLowerCase()
  return queue.filter((item) => item.requestedBy.toLowerCase() === key).length
}

function isActiveNonFallback(videoId: string): boolean {
  return currentSong?.videoId === videoId && !currentSong.isFallback
}

export function hydrateQueue(data: { current?: QueueItem | null; queue?: QueueItem[] }): void {
  if (data.current !== undefined) currentSong = data.current

  if (Array.isArray(data.queue)) {
    queue.length = 0
    let dropped = 0

    for (const item of data.queue) {
      if (isQueued(item.videoId) || isActiveNonFallback(item.videoId)) {
        dropped++
        continue
      }
      queue.push(item)
    }

    if (dropped) log.warn(`dropped ${dropped} duplicate item(s) while restoring the queue`)
  }
}

// Forgets the Channel Points redemption of every queued and current track (they stay as plain tracks). Returns how many there were
export function detachChannelPointsRedemptions(): number {
  let detached = 0

  for (const item of [currentSong, ...queue]) {
    if (item?.channelPointsRedemption) {
      delete item.channelPointsRedemption
      detached++
    }
  }

  if (detached > 0) emit('state')()
  return detached
}

export function getQueue(): QueueItem[] {
  return [...queue]
}

export function getCurrent(): QueueItem | null {
  return currentSong
}

export function setPaused(value: boolean): void {
  isPaused = value
  emit('state')()
}

export function getIsPaused(): boolean {
  return isPaused
}

export function shiftQueue(): QueueItem | null {
  return queue.shift() ?? null
}

export type AddOptions = {
  addToQueue?: boolean
  bypassLimits?: boolean
  channelPointsRedemption?: QueueItem['channelPointsRedemption']
}

function assertCanRequestSong(requestedBy: string, { addToQueue = true, bypassLimits = false }: AddOptions = {}): void {
  const config = getConfig()

  if (addToQueue && queue.length >= config.maxQueueSize) {
    throw new AppError('QUEUE_FULL', 'the queue is full')
  }

  if (bypassLimits) return

  const activeCount = getUserActiveCount(requestedBy)
  if (config.maxRequestsPerUser > 0 && activeCount >= config.maxRequestsPerUser) {
    throw new AppError('USER_LIMIT', `you can only queue ${config.maxRequestsPerUser} track(s) at a time`, {
      count: config.maxRequestsPerUser
    })
  }
}

function assertNotDuplicate(videoId: string): void {
  if (isActiveNonFallback(videoId) || isQueued(videoId)) {
    throw new AppError('DUPLICATE', 'this track is already in the queue')
  }
}

function assertNotBlocked(videoId: string): void {
  if (isBlocked(videoId)) {
    throw new AppError('BLOCKED', 'this track is blocked')
  }
}

export function assertCanAddSong(song: Song, requestedBy: string, options: AddOptions = {}): void {
  assertNotBlocked(song.videoId)
  assertNotDuplicate(song.videoId)
  assertCanRequestSong(requestedBy, options)
}

export function addSong(song: Song, requestedBy: string, options: AddOptions = {}): QueueItem {
  const { addToQueue = true, channelPointsRedemption } = options

  assertCanAddSong(song, requestedBy, options)

  const item: QueueItem = {
    ...song,
    requestedBy,
    ...(channelPointsRedemption ? { channelPointsRedemption } : {})
  }

  if (addToQueue) {
    queue.push(item)
    log.log(`added "${song.title}" at position ${queue.length}`)
  } else {
    log.log(`"${song.title}" will be set as current (not added to queue)`)
  }

  emit('state')()

  return item
}

export function setCurrent(item: QueueItem | null): void {
  const previous = currentSong
  currentSong = item

  if (item?.videoId !== previous?.videoId) {
    log.log(item ? `now playing "${item.title}"` : 'nothing is playing')
  }

  emit('state')()
}

export function removeByVideoId(videoId: string): QueueItem | null {
  return removeAt(queue.findIndex((item) => item.videoId === videoId))
}

export function removeAt(index: number): QueueItem | null {
  if (index < 0 || index >= queue.length) {
    return null
  }

  const [item] = queue.splice(index, 1)

  if (item) {
    log.log(`removed "${item.title}" at position ${index + 1}`)
    finishItem(item, { code: 'TRACK_REMOVED' })
  }

  emit('state')()

  return item ?? null
}

export function clearQueue(): QueueItem[] {
  const cleared = [...queue]
  queue.length = 0

  log.log(`cleared ${cleared.length} songs`)

  for (const item of cleared) finishItem(item, { code: 'QUEUE_CLEARED' })

  emit('state')()

  return cleared
}

export type RequestSongResult =
  | { outcome: 'invalid-url' }
  | { outcome: 'not-found' }
  | { outcome: 'added'; added: AddedSong }
  | { outcome: 'error'; reason: FailureReason }

export async function requestSong(
  query: string,
  requestedBy: string,
  bypassFilters: boolean,
  channelPointsRedemption?: QueueItem['channelPointsRedemption']
): Promise<RequestSongResult> {
  let song: Song | null = null

  try {
    assertCanRequestSong(requestedBy, { addToQueue: currentSong !== null, bypassLimits: bypassFilters })

    const { isYouTube, videoId } = parseYouTubeUrl(query)
    log.log(`[REQUEST] ${requestedBy} → ${videoId ? `YouTube URL: ${videoId}` : `Search: "${query}"`}`)

    if (isYouTube && !videoId) {
      log.log(`[REJECT] ${requestedBy} → INVALID_YOUTUBE_URL`)
      logRejection(requestedBy, query, 'INVALID_YOUTUBE_URL')
      return { outcome: 'invalid-url' }
    }

    if (videoId) {
      assertNotBlocked(videoId)
      assertNotDuplicate(videoId)
      song = await getVideoById(videoId, bypassFilters)
    } else {
      const songs = await searchSongs(query, bypassFilters)
      song = selectBestSong(
        songs,
        (candidate) => !isBlocked(candidate.videoId) && !isQueued(candidate.videoId) && !isActiveNonFallback(candidate.videoId)
      )
    }

    if (!song) {
      log.log(`[REJECT] ${requestedBy} → SONG_NOT_FOUND`)
      logRejection(requestedBy, query, 'SONG_NOT_FOUND')
      return { outcome: 'not-found' }
    }

    const wasEmpty = currentSong === null
    const item = addSong(song, requestedBy, { addToQueue: !wasEmpty, bypassLimits: bypassFilters, channelPointsRedemption })

    if (wasEmpty) {
      setCurrent(item)
      log.log(`[ACCEPT] ${requestedBy} → "${song.title}" - now playing`)
    } else {
      log.log(`[ACCEPT] ${requestedBy} → "${song.title}" - queued`)
    }

    logAcceptance(requestedBy, query, song.title, song.videoId)

    const position = wasEmpty ? 0 : queue.length

    return { outcome: 'added', added: { song: item, started: wasEmpty, position } }
  } catch (error) {
    // an expected refusal (duplicate, limit, filter) is routine; anything else is a bug or an outage and keeps its details
    if (error instanceof AppError) log.log(`[REJECT] ${requestedBy} → ${error.code}`)
    else log.error(`[REJECT] ${requestedBy} → unexpected error while adding song: ${describeError(error, true)}`)

    const reasonCode = error instanceof AppError ? error.code : 'SERVER_ERROR'
    const reasonParams = error instanceof AppError ? error.params : undefined
    logRejection(requestedBy, query, reasonCode, { title: song?.title ?? null, videoId: song?.videoId ?? null, reasonParams })
    return { outcome: 'error', reason: { code: reasonCode, params: reasonParams } }
  }
}
