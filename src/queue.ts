import { getConfig } from './config.js'
import { getVideoById, searchSongs, selectBestSong } from './youtube/index.js'
import { parseYouTubeUrl } from './youtube/url.js'
import { logRejection, logAcceptance, logSkippedWithOpenReward } from './activity.js'
import { QueueItem, Song, AppError, AddedSong } from './types.js'
import { isBlocked } from './blocklist.js'
import { createStore } from './store.js'
import { finishItem } from './finish.js'
import { persistState } from './state-file.js'
import { createLogger } from './logger.js'

let currentSong: QueueItem | null = null
const queue: QueueItem[] = []

let isPaused = false
let playCounter = 0

// the playing state is saved and announced by the store when it changes
const playing = createStore({
  read: () => ({ current: currentSong, queue, isPaused }),
  topics: ['state'],
  save: persistState
})

const log = createLogger('QUEUE')

// Everything below is derived from `queue` on demand, so there is no second copy that could drift apart from it
const isQueued = (videoId: string): boolean => queue.some((item) => item.videoId === videoId)

function getUserActiveCount(username: string): number {
  const key = username.toLowerCase()
  const isTheirs = (item: QueueItem): boolean => item.requestedBy.toLowerCase() === key
  const playing = currentSong !== null && !currentSong.isFallback && isTheirs(currentSong)

  return queue.filter(isTheirs).length + (playing ? 1 : 0)
}

function isActiveNonFallback(videoId: string): boolean {
  return currentSong?.videoId === videoId && !currentSong.isFallback
}

export function hydrateQueue(data: { current?: QueueItem | null; queue?: QueueItem[] }): void {
  if (data.current !== undefined) currentSong = data.current
  playCounter = Math.max(playCounter, data.current?.playId ?? 0)

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

  playing.update(() => {
    for (const item of [currentSong, ...queue]) {
      if (item?.channelPointsRedemption) {
        delete item.channelPointsRedemption
        detached++
      }
    }
  })

  return detached
}

export function getQueue(): QueueItem[] {
  return [...queue]
}

export function getCurrent(): QueueItem | null {
  return currentSong
}

export function setPaused(value: boolean): void {
  playing.update(() => {
    isPaused = value
  })
}

export function getIsPaused(): boolean {
  return isPaused
}

export function shiftQueue(): QueueItem | null {
  return queue.shift() ?? null
}

export type AddOptions = {
  bypassLimits?: boolean
  channelPointsRedemption?: QueueItem['channelPointsRedemption']
}

function assertCanRequestSong(requestedBy: string, { bypassLimits = false }: AddOptions = {}): void {
  const config = getConfig()

  if (currentSong !== null && queue.length >= config.maxQueueSize) {
    throw new AppError('QUEUE_FULL')
  }

  if (bypassLimits) return

  const activeCount = getUserActiveCount(requestedBy)
  if (config.maxRequestsPerUser > 0 && activeCount >= config.maxRequestsPerUser) {
    throw new AppError('USER_LIMIT', undefined, { count: config.maxRequestsPerUser })
  }
}

function assertNotDuplicate(videoId: string): void {
  if (isActiveNonFallback(videoId) || isQueued(videoId)) {
    throw new AppError('DUPLICATE')
  }
}

function assertNotBlocked(videoId: string): void {
  if (isBlocked(videoId)) {
    throw new AppError('BLOCKED')
  }
}

export function assertCanAddSong(song: Song, requestedBy: string, options: AddOptions = {}): void {
  assertNotBlocked(song.videoId)
  assertNotDuplicate(song.videoId)
  assertCanRequestSong(requestedBy, options)
}

export function addSong(song: Song, requestedBy: string, options: AddOptions = {}): { item: QueueItem; started: boolean } {
  assertCanAddSong(song, requestedBy, options)

  const item: QueueItem = {
    ...song,
    requestedBy,
    ...(options.channelPointsRedemption ? { channelPointsRedemption: options.channelPointsRedemption } : {})
  }
  const started = currentSong === null

  if (started) {
    setCurrent(item)
  } else {
    playing.update(() => {
      queue.push(item)
    })
    log.log(`added "${song.title}" at position ${queue.length}`)
  }

  return { item, started }
}

export function setCurrent(item: QueueItem | null): void {
  const previous = currentSong

  // still attached = nobody closed it, so the track was skipped or replaced with its reward open
  if (previous?.channelPointsRedemption && previous !== item) {
    log.warn(`"${previous.title}" was bought with Channel Points: the reward stays UNFULFILLED on Twitch until it is fulfilled or refunded there`)
    logSkippedWithOpenReward(previous)
  }

  if (item?.videoId !== previous?.videoId) {
    log.log(item ? `now playing "${item.title}"` : 'nothing is playing')
  }

  playing.update(() => {
    if (item === null) {
      currentSong = null
    } else {
      item.playId = ++playCounter
      currentSong = item
    }
  })
}

export function removeByVideoId(videoId: string): QueueItem | null {
  return removeAt(queue.findIndex((item) => item.videoId === videoId))
}

export function removeAt(index: number): QueueItem | null {
  if (index < 0 || index >= queue.length) {
    return null
  }

  let removed: QueueItem | undefined

  playing.update(() => {
    const [item] = queue.splice(index, 1)
    removed = item

    if (item) {
      log.log(`removed "${item.title}" at position ${index + 1}`)
      finishItem(item, { code: 'TRACK_REMOVED' })
    }
  })

  return removed ?? null
}

export function clearQueue(): QueueItem[] {
  let cleared: QueueItem[] = []

  playing.update(() => {
    cleared = [...queue]
    queue.length = 0
    for (const item of cleared) finishItem(item, { code: 'QUEUE_CLEARED' })
  })

  log.log(`cleared ${cleared.length} songs`)

  return cleared
}

type RequestOptions = {
  // an admin request (from this computer): the filters and the limits do not apply
  bypassFilters?: boolean
  // set when a Channel Points redemption paid for the request: the track carries it until the redemption is closed
  channelPointsRedemption?: QueueItem['channelPointsRedemption']
}

// Adds the song the query names to the queue, or throws the AppError that says why not (a duplicate,
// a limit, a filter, a bad URL); the activity journal entry is written on the way out, in one place
export async function requestSong(query: string, requestedBy: string, { bypassFilters = false, channelPointsRedemption }: RequestOptions = {}): Promise<AddedSong> {
  let song: Song | null = null

  try {
    assertCanRequestSong(requestedBy, { bypassLimits: bypassFilters })

    const { isYouTube, videoId } = parseYouTubeUrl(query)
    log.log(`[REQUEST] ${requestedBy} → ${videoId ? `YouTube URL: ${videoId}` : `Search: "${query}"`}`)

    if (isYouTube && !videoId) {
      throw new AppError('INVALID_YOUTUBE_URL')
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

    if (!song) throw new AppError('SONG_NOT_FOUND')

    const { item, started } = addSong(song, requestedBy, { bypassLimits: bypassFilters, channelPointsRedemption })

    log.log(`[ACCEPT] ${requestedBy} → "${song.title}" - ${started ? 'now playing' : 'queued'}`)
    logAcceptance(requestedBy, query, song.title, song.videoId)

    return { song: item, started, position: started ? 0 : queue.length }
  } catch (error) {
    // an expected refusal (duplicate, limit, filter) is routine and logRejection() writes it down; anything
    // else is a bug or an outage, and the handler that owns the request logs it once with its details
    logRejection(requestedBy, query, error instanceof AppError ? error.code : 'SERVER_ERROR', {
      title: song?.title ?? null,
      videoId: song?.videoId ?? null,
      reasonParams: error instanceof AppError ? error.params : undefined
    })
    throw error
  }
}
