import { StateResponse, QueueItem } from './types.js'
import { isBlocked } from '../blocklist/service.js'
import { logRejection, logFailure } from '../activity/service.js'
import { getQueue, getCurrent, getIsPaused, setCurrent, shiftQueue } from '../queue/service.js'
import { peekNextFallbackTrack, advanceFallback } from '../playlists/fallback.js'

function log(message: string): void {
  console.log(`[PLAYER] ${message}`)
}

export function getNextTrack(): QueueItem | null {
  return getQueue().find((item) => !isBlocked(item.videoId)) ?? peekNextFallbackTrack()
}

export function getState(): StateResponse {
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
    logRejection(next.requestedBy, next.title, 'BLOCKED', { title: next.title, videoId: next.videoId })
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
