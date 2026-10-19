import { StateResponse, QueueItem, ActivityReasonCode } from './types.js'
import { isBlocked, markBlocked } from './blocklist.js'
import { getQueue, getCurrent, setCurrent, takeNextPlayable } from './queue.js'
import { peekNextFallbackTrack, advanceFallback } from './fallback.js'
import { finishItem, type ItemOutcome } from './finish.js'
import { createStore } from './store.js'
import { createLogger } from './logger.js'

const log = createLogger('PLAYER')

let isPaused = false

// pausing is part of the announced state, but of nothing saved: it never survives a restart anyway
const paused = createStore({
  read: () => isPaused,
  topics: ['state']
})

export function setPaused(value: boolean): void {
  paused.update(() => {
    isPaused = value
  })
}

export function getIsPaused(): boolean {
  return isPaused
}

export function getNextTrack(): QueueItem | null {
  return getQueue().find((item) => !isBlocked(item.videoId)) ?? peekNextFallbackTrack()
}

export function getState(): StateResponse {
  return {
    current: getCurrent(),
    queue: markBlocked(getQueue()),
    isPaused: getIsPaused(),
    nextTrack: getNextTrack()
  }
}

export function moveToNext(): QueueItem | null {
  const next = takeNextPlayable()
  if (next) return next

  const fallback = advanceFallback()
  setCurrent(fallback)
  if (fallback) log.log(`started fallback: "${fallback.title}"`)

  return getCurrent()
}

// The one way the current track leaves the player. The outcome owns the log line, and finishItem turns it
// into the journal entry and the reward decision; whatever plays next is decided here alone
function leaveCurrent(outcome: ItemOutcome): QueueItem | null {
  const leaving = getCurrent()

  if (leaving) {
    if (outcome === 'skipped') {
      log.log(`skipped "${leaving.title}"`)
    } else if (typeof outcome === 'object') {
      if (outcome.code === 'BLOCKED') log.log(`current track was blocked, skipping: "${leaving.title}"`)
      else {
        // a track that cannot be played is routine (the journal and the chat reply say why): an error entry would be noise
        log.warn(`playback failed: "${leaving.title}" (error ${outcome.params?.errorCode ?? 'unknown'})`)
      }
    }
    // 'played' is the routine way out: the line about what plays next tells the story
  }

  finishItem(leaving, outcome)
  return moveToNext()
}

export function skipCurrent(): QueueItem | null {
  return leaveCurrent('skipped')
}

export function skipIfCurrent(videoId: string): boolean {
  const current = getCurrent()
  if (current?.videoId !== videoId) return false

  leaveCurrent({ code: 'BLOCKED' })
  return true
}

// the YouTube iframe error codes that say why a track cannot be played
const PLAYBACK_FAILURE_REASONS: Record<number, ActivityReasonCode> = {
  100: 'PLAYBACK_VIDEO_UNAVAILABLE',
  101: 'PLAYBACK_EMBED_DISALLOWED',
  150: 'PLAYBACK_EMBED_DISALLOWED'
}

// -1 is never in the table, so an unreported code falls through to the generic reason
function playbackFailureReasonCode(errorCode?: number): ActivityReasonCode {
  return PLAYBACK_FAILURE_REASONS[errorCode ?? -1] ?? 'PLAYBACK_FAILED'
}

function isAboutCurrent(videoId?: string, playId?: number): boolean {
  // the play id tells an old play of the same track from the one that runs now
  if (playId !== undefined) return getCurrent()?.playId === playId && (videoId === undefined || getCurrent()?.videoId === videoId)
  return videoId === undefined || getCurrent()?.videoId === videoId
}

// The player reports that a play of `videoId` finished. Returns false if that was not the current play and nothing changed
export function endCurrent(videoId?: string, playId?: number): boolean {
  if (!isAboutCurrent(videoId, playId)) {
    log.log(`ignored "ended" for ${videoId}: it is not the current track`)
    return false
  }

  leaveCurrent('played')
  return true
}

// The player reports that a play of `videoId` failed. Returns false if nothing was playing or the report was
// about another play: a stray report must not start the fallback on its own
export function reportPlaybackFailure(errorCode?: number, videoId?: string, playId?: number): boolean {
  if (getCurrent() === null || !isAboutCurrent(videoId, playId)) {
    log.log(`ignored playback failure for ${videoId ?? 'an unnamed track'}: it is not the current track`)
    return false
  }

  leaveCurrent({ code: playbackFailureReasonCode(errorCode), params: errorCode !== undefined ? { errorCode } : undefined })
  return true
}
