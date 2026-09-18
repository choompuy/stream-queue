import { getSettings, setSettings } from './settings.js'
import { getConfig } from './config.js'
import { getVideoById, searchSongs, selectBestSong } from './youtube/index.js'
import { parseYouTubeUrl } from './youtube/url.js'
import { STATE_FILE, createFileStore } from './persist.js'
import { logActivity } from './activity.js'
import { Settings, QueueItem, Song, PlayerState, AppError, QueueRequestResponse } from './types.js'
import { peekNextFallbackTrack, advanceFallback, getFallbackSnapshot, hydrateFallback, FallbackSnapshot } from './fallback.js'
import { t } from './i18n.js'
import { isBlocked } from './blocklist.js'

type StateFile = {
  current: QueueItem | null
  queue: QueueItem[]
  settings: Settings
  fallback: FallbackSnapshot
}

const store = createFileStore<Partial<StateFile>>(STATE_FILE)

let currentSong: QueueItem | null = null
const queue: QueueItem[] = []
const queueVideoIds = new Set<string>()
const userQueueCounts = new Map<string, number>()

let isPaused = false

function log(message: string): void {
  console.log(`[QUEUE] ${message}`)
}

async function loadState(): Promise<void> {
  try {
    const data = store.load({})

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

    if (data.settings) {
      const settingsWithLocale = { ...data.settings, locale: data.settings.locale || 'en' }
      setSettings(settingsWithLocale)
    }

    hydrateFallback(data.fallback)

    log('State loaded from disk')
  } catch (error) {
    console.error('[QUEUE] Failed to load state:', error instanceof Error ? error.message : error)
  }
}

function stateSnapshot(): StateFile {
  return {
    current: currentSong,
    queue: [...queue],
    settings: getSettings(),
    fallback: getFallbackSnapshot()
  }
}

export function saveState(): void {
  store.scheduleSave(stateSnapshot, (error) => {
    console.error('[QUEUE] Failed to save state:', error instanceof Error ? error.message : error)
  })
}

loadState()

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

export function getState(): PlayerState & { nextTrack: QueueItem | null } {
  return {
    current: currentSong,
    queue: [...queue],
    isPaused,
    nextTrack: getNextTrack()
  }
}

export function getNextTrack(): QueueItem | null {
  return queue[0] ?? peekNextFallbackTrack()
}

export function getQueue(): QueueItem[] {
  return [...queue]
}

export function getCurrent(): QueueItem | null {
  return currentSong
}

export function setPaused(value: boolean): void {
  isPaused = value
}

export function getIsPaused(): boolean {
  return isPaused
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

  saveState()

  return item
}

export function setCurrent(item: QueueItem | null): void {
  currentSong = item

  if (item) {
    log(`[PLAYER] started "${item.title}"`)
  } else {
    log(`[PLAYER] stopped`)
  }

  saveState()
}

export function moveToNext(): QueueItem | null {
  const next = queue.shift() ?? null

  if (next) {
    queueVideoIds.delete(next.videoId)
    decUserCount(next.requestedBy)
    setCurrent(next)
    log(`[PLAYER] moved to next: "${next.title}"`)
  } else {
    const fallback = advanceFallback()
    setCurrent(fallback)
    if (fallback) {
      log(`[PLAYER] started fallback: "${fallback.title}"`)
    }
  }

  return currentSong
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

  saveState()

  return item ?? null
}

export function clearQueue(): QueueItem[] {
  const cleared = [...queue]
  queue.length = 0
  queueVideoIds.clear()
  userQueueCounts.clear()

  log(`[QUEUE] cleared ${cleared.length} songs`)

  saveState()

  return cleared
}

export function skipCurrent(): QueueItem | null {
  const skipped = currentSong

  if (skipped) {
    log(`[PLAYER] skipped "${skipped.title}"`)
  }

  return moveToNext()
}

function playbackFailureReasonCode(errorCode?: number): string {
  switch (errorCode) {
    case 100:
      return 'PLAYBACK_VIDEO_UNAVAILABLE'
    case 101:
    case 150:
      return 'PLAYBACK_EMBED_DISALLOWED'
    default:
      return 'PLAYBACK_FAILED'
  }
}

export function reportPlaybackFailure(errorCode?: number): QueueItem | null {
  const failed = currentSong

  if (failed) {
    log(`[PLAYER] playback failed: "${failed.title}" (error ${errorCode ?? 'unknown'})`)
    logActivity({
      requestedBy: failed.requestedBy,
      query: failed.title,
      title: failed.title,
      videoId: failed.videoId,
      status: 'failed',
      reasonCode: playbackFailureReasonCode(errorCode),
      reasonParams: errorCode !== undefined ? { errorCode } : undefined
    })
  }

  return moveToNext()
}

export type RequestSongResult =
  | { outcome: 'invalid-url' }
  | { outcome: 'not-found' }
  | { outcome: 'added'; response: QueueRequestResponse }
  | { outcome: 'error'; error: unknown }

export async function requestSong(query: string, requestedBy: string, bypassFilters: boolean): Promise<RequestSongResult> {
  let song: Song | null = null

  try {
    assertCanRequestSong(requestedBy, getState().current !== null, bypassFilters)

    const { isYouTube, videoId } = parseYouTubeUrl(query)

    if (isYouTube && !videoId) {
      log(`[REJECT] ${requestedBy} → INVALID_YOUTUBE_URL`)
      logActivity({ requestedBy, query, title: null, videoId: null, status: 'rejected', reasonCode: 'INVALID_YOUTUBE_URL' })
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
      logActivity({ requestedBy, query, title: null, videoId: null, status: 'rejected', reasonCode: 'SONG_NOT_FOUND' })
      return { outcome: 'not-found' }
    }

    const stateBefore = getState()
    const wasEmpty = stateBefore.current === null
    const item = addSong(song, requestedBy, !wasEmpty, bypassFilters)

    if (wasEmpty) {
      setCurrent(item)
      log(`[ACCEPT] ${requestedBy} → "${song.title}" - now playing`)
    } else {
      log(`[ACCEPT] ${requestedBy} → "${song.title}" - queued`)
    }

    logActivity({ requestedBy, query, title: song.title, videoId: song.videoId, status: 'accepted', reasonCode: null })

    const state = getState()
    const position = wasEmpty ? 0 : state.queue.length
    const locale = getSettings().locale
    const message = wasEmpty
      ? (t(locale, 'toast.nowPlaying', { title: song.title }) ?? `Now playing: ${song.title}`)
      : (t(locale, 'toast.addedToQueue', { title: song.title, position }) ?? `Added to queue: ${song.title} [#${position}]`)

    return {
      outcome: 'added',
      response: {
        message,
        song: item,
        started: wasEmpty,
        position,
        state
      }
    }
  } catch (error) {
    log(`[REJECT] ${requestedBy} → error while adding song`)
    const reasonCode = error instanceof AppError ? error.code : 'SERVER_ERROR'
    const reasonParams = error instanceof AppError ? error.params : undefined
    logActivity({
      requestedBy,
      query,
      title: song?.title ?? null,
      videoId: song?.videoId ?? null,
      status: 'rejected',
      reasonCode,
      reasonParams
    })
    return { outcome: 'error', error }
  }
}
