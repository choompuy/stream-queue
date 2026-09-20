import { getSettings, setSettings } from './settings.js'
import { STATE_FILE, createFileStore } from './persist.js'
import { PlayerState, QueueItem, ActivityReasonCode, Settings } from './types.js'
import { isBlocked } from './blocklist.js'
import { onStateChange } from './state-events.js'
import { logActivity } from './activity.js'
import { getQueue, getCurrent, getIsPaused, setCurrent, shiftQueue, hydrateQueue } from './queue.js'
import { peekNextFallbackTrack, advanceFallback, getFallbackSnapshot, hydrateFallback, FallbackSnapshot } from './fallback.js'

function log(message: string): void {
  console.log(`[PLAYER] ${message}`)
}

function logRejection(requestedBy: string, query: string, reasonCode: ActivityReasonCode, videoId: string): void {
  logActivity({ requestedBy, query, title: query, videoId, status: 'rejected', reasonCode })
}

function logFailure(item: QueueItem, reasonCode: ActivityReasonCode, reasonParams?: Record<string, string | number>): void {
  logActivity({
    requestedBy: item.requestedBy,
    query: item.title,
    title: item.title,
    videoId: item.videoId,
    status: 'failed',
    reasonCode,
    reasonParams
  })
}

export function getNextTrack(): QueueItem | null {
  return getQueue().find((item) => !isBlocked(item.videoId)) ?? peekNextFallbackTrack()
}

export function getState(): PlayerState & { nextTrack: QueueItem | null } {
  return {
    current: getCurrent(),
    queue: getQueue(),
    isPaused: getIsPaused(),
    nextTrack: getNextTrack()
  }
}

export function moveToNext(): QueueItem | null {
  let next = shiftQueue()

  while (next && isBlocked(next.videoId)) {
    log(`skipped blocked track in queue: "${next.title}"`)
    logRejection(next.requestedBy, next.title, 'BLOCKED', next.videoId)
    next = shiftQueue()
  }

  if (next) {
    setCurrent(next)
    log(`moved to next: "${next.title}"`)
  } else {
    const fallback = advanceFallback()
    setCurrent(fallback)
    if (fallback) log(`started fallback: "${fallback.title}"`)
  }

  return getCurrent()
}

export function skipCurrent(): QueueItem | null {
  const skipped = getCurrent()
  if (skipped) log(`skipped "${skipped.title}"`)
  return moveToNext()
}

export function skipIfCurrent(videoId: string): boolean {
  const current = getCurrent()
  if (current?.videoId !== videoId) return false

  log(`current track was blocked, skipping: "${current.title}"`)
  moveToNext()
  return true
}

export function playbackFailureReasonCode(errorCode?: number): ActivityReasonCode {
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

function isAboutCurrent(videoId?: string): boolean {
  return videoId === undefined || getCurrent()?.videoId === videoId
}

// The player reports that `videoId` finished. Returns false if that was not the current track and nothing changed
export function endCurrent(videoId?: string): boolean {
  if (!isAboutCurrent(videoId)) {
    log(`ignored "ended" for ${videoId}: it is not the current track`)
    return false
  }

  moveToNext()
  return true
}

// The player reports that `videoId` failed. Returns false if that was not the current track and nothing changed
export function reportPlaybackFailure(errorCode?: number, videoId?: string): boolean {
  if (!isAboutCurrent(videoId)) {
    log(`ignored playback failure for ${videoId}: it is not the current track`)
    return false
  }

  const failed = getCurrent()

  if (failed) {
    log(`playback failed: "${failed.title}" (error ${errorCode ?? 'unknown'})`)
    logFailure(failed, playbackFailureReasonCode(errorCode), errorCode !== undefined ? { errorCode } : undefined)
  }

  moveToNext()
  return true
}

// --- Combined-state persistence: this is the one place that knows the on-disk
// state.json shape spans queue + settings + fallback, so it's the one place
// that needs to import all three, rather than queue.ts reaching into fallback.ts.

type StateFile = {
  current: QueueItem | null
  queue: QueueItem[]
  settings: Settings
  fallback: FallbackSnapshot
}

const store = createFileStore<Partial<StateFile>>(STATE_FILE)

function stateSnapshot(): StateFile {
  return {
    current: getCurrent(),
    queue: getQueue(),
    settings: getSettings(),
    fallback: getFallbackSnapshot()
  }
}

function persistState(): void {
  store.scheduleSave(stateSnapshot, (error) => {
    console.error('[PLAYER] Failed to save state:', error instanceof Error ? error.message : error)
  })
}

onStateChange(persistState)

function loadState(): void {
  try {
    const data = store.load({})

    hydrateQueue({ current: data.current, queue: data.queue })

    if (data.settings) {
      setSettings({ ...data.settings, locale: data.settings.locale || 'en' })
    }

    hydrateFallback(data.fallback)

    log('State loaded from disk')
  } catch (error) {
    console.error('[PLAYER] Failed to load state:', error instanceof Error ? error.message : error)
  }
}

loadState()
