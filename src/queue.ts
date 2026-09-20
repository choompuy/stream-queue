import { getConfig } from './config.js'
import { getVideoById, searchSongs, selectBestSong } from './youtube/index.js'
import { parseYouTubeUrl } from './youtube/url.js'
import { logActivity } from './activity.js'
import { QueueItem, Song, PlayerState, AppError, QueueRequestResponse, ActivityReasonCode } from './types.js'
import { isBlocked } from './blocklist.js'
import { notifyStateChange } from './state-events.js'

function logRejection(
  requestedBy: string,
  query: string,
  reasonCode: ActivityReasonCode,
  options: { title?: string | null; videoId?: string | null; reasonParams?: Record<string, string | number> } = {}
): void {
  logActivity({
    requestedBy,
    query,
    title: options.title ?? null,
    videoId: options.videoId ?? null,
    status: 'rejected',
    reasonCode,
    reasonParams: options.reasonParams
  })
}

function logAcceptance(requestedBy: string, query: string, title: string, videoId: string): void {
  logActivity({ requestedBy, query, title, videoId, status: 'accepted', reasonCode: null })
}

let currentSong: QueueItem | null = null
const queue: QueueItem[] = []
const queueVideoIds = new Set<string>()
const userQueueCounts = new Map<string, number>()

let isPaused = false

function log(message: string): void {
  console.log(`[QUEUE] ${message}`)
}

function incUserCount(requestedBy: string): void {
  const key = requestedBy.toLowerCase()
  userQueueCounts.set(key, (userQueueCounts.get(key) ?? 0) + 1)
}

function decUserCount(requestedBy: string): void {
  const key = requestedBy.toLowerCase()
  const count = (userQueueCounts.get(key) ?? 0) - 1
  if (count > 0) {
    userQueueCounts.set(key, count)
  } else {
    userQueueCounts.delete(key)
  }
}

function getUserActiveCount(username: string): number {
  return userQueueCounts.get(username.toLowerCase()) ?? 0
}

export function hydrateQueue(data: { current?: QueueItem | null; queue?: QueueItem[] }): void {
  if (data.current) currentSong = data.current

  if (Array.isArray(data.queue)) {
    queue.length = 0
    queueVideoIds.clear()
    userQueueCounts.clear()
    for (const item of data.queue) {
      queue.push(item)
      queueVideoIds.add(item.videoId)
      incUserCount(item.requestedBy)
    }
  }
}

export function getQueue(): QueueItem[] {
  return [...queue]
}

export function getCurrent(): QueueItem | null {
  return currentSong
}

export function setPaused(value: boolean): void {
  isPaused = value
  notifyStateChange()
}

export function getIsPaused(): boolean {
  return isPaused
}

export function shiftQueue(): QueueItem | null {
  const next = queue.shift() ?? null
  if (next) {
    queueVideoIds.delete(next.videoId)
    decUserCount(next.requestedBy)
  }
  return next
}

function assertCanRequestSong(requestedBy: string, addToQueue: boolean, bypassLimits: boolean): void {
  const config = getConfig()

  if (addToQueue && queue.length >= config.maxQueueSize) {
    throw new AppError('QUEUE_FULL', 'the queue is full')
  }

  if (bypassLimits) return

  const activeCount = getUserActiveCount(requestedBy.toLowerCase())
  if (config.maxRequestsPerUser > 0 && activeCount >= config.maxRequestsPerUser) {
    throw new AppError('USER_LIMIT', `you can only queue ${config.maxRequestsPerUser} track(s) at a time`, {
      count: config.maxRequestsPerUser
    })
  }
}

function assertNotDuplicate(videoId: string): void {
  if (currentSong?.videoId === videoId && !currentSong.isFallback) {
    throw new AppError('DUPLICATE', 'this track is already in the queue')
  }

  if (queueVideoIds.has(videoId)) {
    throw new AppError('DUPLICATE', 'this track is already in the queue')
  }
}

function assertNotBlocked(videoId: string): void {
  if (isBlocked(videoId)) {
    throw new AppError('BLOCKED', 'this track is blocked')
  }
}

export function assertCanAddSong(song: Song, requestedBy: string, addToQueue: boolean, bypassLimits: boolean = false): void {
  assertNotBlocked(song.videoId)
  assertNotDuplicate(song.videoId)
  assertCanRequestSong(requestedBy, addToQueue, bypassLimits)
}

export function addSong(song: Song, requestedBy: string, addToQueue: boolean = true, bypassLimits: boolean = false): QueueItem {
  log(`[REQUEST] ${requestedBy} → "${song.title}"`)

  assertCanAddSong(song, requestedBy, addToQueue, bypassLimits)

  const item: QueueItem = {
    ...song,
    requestedBy
  }

  if (addToQueue) {
    queue.push(item)
    queueVideoIds.add(item.videoId)
    incUserCount(requestedBy)
    log(`[QUEUE] added "${song.title}" at position ${queue.length}`)
  } else {
    log(`[QUEUE] "${song.title}" will be set as current (not added to queue)`)
  }

  notifyStateChange()

  return item
}

export function setCurrent(item: QueueItem | null): void {
  currentSong = item

  if (item) {
    log(`[PLAYER] started "${item.title}"`)
  } else {
    log(`[PLAYER] stopped`)
  }

  notifyStateChange()
}

export function removeAt(index: number): QueueItem | null {
  if (index < 0 || index >= queue.length) {
    return null
  }

  const [item] = queue.splice(index, 1)

  if (item) {
    queueVideoIds.delete(item.videoId)
    decUserCount(item.requestedBy)
    log(`[QUEUE] removed "${item.title}" at position ${index + 1}`)
  }

  notifyStateChange()

  return item ?? null
}

export function clearQueue(): QueueItem[] {
  const cleared = [...queue]
  queue.length = 0
  queueVideoIds.clear()
  userQueueCounts.clear()

  log(`[QUEUE] cleared ${cleared.length} songs`)

  notifyStateChange()

  return cleared
}

export type RequestSongResult =
  | { outcome: 'invalid-url' }
  | { outcome: 'not-found' }
  | { outcome: 'added'; response: QueueRequestResponse }
  | { outcome: 'error'; error: unknown }

export async function requestSong(query: string, requestedBy: string, bypassFilters: boolean): Promise<RequestSongResult> {
  let song: Song | null = null

  try {
    assertCanRequestSong(requestedBy, currentSong !== null, bypassFilters)

    const { isYouTube, videoId } = parseYouTubeUrl(query)

    if (isYouTube && !videoId) {
      log(`[REJECT] ${requestedBy} → INVALID_YOUTUBE_URL`)
      logRejection(requestedBy, query, 'INVALID_YOUTUBE_URL')
      return { outcome: 'invalid-url' }
    }

    if (videoId) {
      assertNotBlocked(videoId)
      assertNotDuplicate(videoId)
      log(`[REQUEST] ${requestedBy} → YouTube URL: ${videoId}`)
      song = await getVideoById(videoId, bypassFilters)
    } else {
      log(`[REQUEST] ${requestedBy} → Search: "${query}"`)
      const songs = await searchSongs(query, bypassFilters)
      song = selectBestSong(songs, query)
    }

    if (!song) {
      log(`[REJECT] ${requestedBy} → SONG_NOT_FOUND`)
      logRejection(requestedBy, query, 'SONG_NOT_FOUND')
      return { outcome: 'not-found' }
    }

    const wasEmpty = currentSong === null
    const item = addSong(song, requestedBy, !wasEmpty, bypassFilters)

    if (wasEmpty) {
      setCurrent(item)
      log(`[ACCEPT] ${requestedBy} → "${song.title}" - now playing`)
    } else {
      log(`[ACCEPT] ${requestedBy} → "${song.title}" - queued`)
    }

    logAcceptance(requestedBy, query, song.title, song.videoId)

    const position = wasEmpty ? 0 : queue.length
    const state: PlayerState = { current: currentSong, queue: getQueue(), isPaused }

    return {
      outcome: 'added',
      response: { song: item, started: wasEmpty, position, state }
    }
  } catch (error) {
    log(`[REJECT] ${requestedBy} → error while adding song`)
    const reasonCode = error instanceof AppError ? error.code : 'SERVER_ERROR'
    const reasonParams = error instanceof AppError ? error.params : undefined
    logRejection(requestedBy, query, reasonCode, { title: song?.title ?? null, videoId: song?.videoId ?? null, reasonParams })
    return { outcome: 'error', error }
  }
}
