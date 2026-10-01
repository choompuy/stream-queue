import { StateResponse, QueueItem, ActivityReasonCode, FailureReason } from './types.js'
import { isBlocked } from './blocklist.js'
import { logRejection, logFailure } from './activity.js'
import { getQueue, getCurrent, getIsPaused, setCurrent, shiftQueue } from './queue.js'
import { peekNextFallbackTrack, advanceFallback } from './fallback.js'
import { createLogger } from './logger.js'

const log = createLogger('PLAYER')

// Set by the Twitch integration (if enabled) so a playback failure on a Channel Points track can
// still be reported back to Twitch (refund the points, notify the requester) - player.ts stays
// unaware of Twitch beyond this one hook, so it works the same with the integration off
type ChannelPointsFailureHandler = (redemption: NonNullable<QueueItem['channelPointsRedemption']>, reason: FailureReason) => void
let onChannelPointsPlaybackFailure: ChannelPointsFailureHandler | null = null

export function registerChannelPointsPlaybackFailureHandler(handler: ChannelPointsFailureHandler | null): void {
  onChannelPointsPlaybackFailure = handler
}

type ChannelPointsSuccessHandler = (redemption: NonNullable<QueueItem['channelPointsRedemption']>) => void
let onChannelPointsPlaybackSuccess: ChannelPointsSuccessHandler | null = null

export function registerChannelPointsPlaybackSuccessHandler(handler: ChannelPointsSuccessHandler | null): void {
  onChannelPointsPlaybackSuccess = handler
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
    log.log(`skipped blocked track in queue: "${next.title}"`)
    logRejection(next.requestedBy, next.title, 'BLOCKED', { title: next.title, videoId: next.videoId })
    next = shiftQueue()
  }

  if (next) {
    setCurrent(next)
    log.log(`moved to next: "${next.title}"`)
  } else {
    const fallback = advanceFallback()
    setCurrent(fallback)
    if (fallback) log.log(`started fallback: "${fallback.title}"`)
  }

  return getCurrent()
}

export function skipCurrent(): QueueItem | null {
  const skipped = getCurrent()
  if (skipped) {
    log.log(`skipped "${skipped.title}"`)
  }
  return moveToNext()
}

export function skipIfCurrent(videoId: string): boolean {
  const current = getCurrent()
  if (current?.videoId !== videoId) return false

  log.log(`current track was blocked, skipping: "${current.title}"`)
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
    log.log(`ignored "ended" for ${videoId}: it is not the current track`)
    return false
  }

  const finished = getCurrent()
  if (finished?.channelPointsRedemption) {
    onChannelPointsPlaybackSuccess?.(finished.channelPointsRedemption)
  }

  moveToNext()
  return true
}

// The player reports that `videoId` failed. Returns false if that was not the current track and nothing changed
export function reportPlaybackFailure(errorCode?: number, videoId?: string): boolean {
  if (!isAboutCurrent(videoId)) {
    log.log(`ignored playback failure for ${videoId}: it is not the current track`)
    return false
  }

  const failed = getCurrent()

  if (failed) {
    const reasonCode = playbackFailureReasonCode(errorCode)
    log.error(`playback failed: "${failed.title}" (error ${errorCode ?? 'unknown'})`)
    logFailure(failed, reasonCode, errorCode !== undefined ? { errorCode } : undefined)

    if (failed.channelPointsRedemption) {
      onChannelPointsPlaybackFailure?.(failed.channelPointsRedemption, { code: reasonCode, params: { title: failed.title } })
    }
  }

  moveToNext()
  return true
}
