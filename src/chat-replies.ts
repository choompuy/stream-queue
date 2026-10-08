import { translateWithFallback, t } from './i18n.js'
import { getSettings } from './settings.js'
import { getState } from './player.js'
import type { PlayerState, FailureReason } from './types.js'

const truncate = (s: string, max = 40) => {
  const chars = Array.from(s)
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : s
}

// "Now playing: X (requested by Y)" / "Nothing is playing right now" - shared by the HTTP chat endpoint and the Twitch chat module
export function buildNowPlayingMessage(): string {
  const state = getState()

  if (!state.current) {
    return translateWithFallback('chat.nothingPlaying', undefined, 'Nothing is playing right now')
  }

  const base = translateWithFallback(
    'chat.nowPlayingWithRequester',
    { title: state.current.title, requestedBy: state.current.requestedBy },
    `Now playing: ${state.current.title} (requested by ${state.current.requestedBy})`
  )
  const pausedSuffix = state.isPaused ? translateWithFallback('chat.pausedSuffix', undefined, ' (paused)') : ''
  return base + pausedSuffix
}

// "Track skipped. Now playing: X" / "Track skipped" - shared by the HTTP player route and the Twitch chat module
export function buildSkipMessage(state: PlayerState): string {
  return state.current?.title
    ? translateWithFallback('chat.skippedNowPlaying', { title: state.current.title }, `Track skipped. Now playing: ${state.current.title}`)
    : translateWithFallback('chat.skipped', undefined, 'Track skipped')
}

// "Queue [N]: 1. Title | 2. Title ... [+more]" / "The queue is empty" - shared by the HTTP chat endpoint and the Twitch chat module
export function buildQueueMessage(): string {
  const state = getState()

  if (state.queue.length === 0) {
    return translateWithFallback('chat.queueEmpty', undefined, 'The queue is empty')
  }

  const maxShown = 4

  const list = state.queue
    .slice(0, maxShown)
    .map((item, i) => `${i + 1}. ${truncate(item.title)}`)
    .join(' | ')
  const base = translateWithFallback('chat.queueList', { count: state.queue.length, list }, `Queue [${state.queue.length}]: ${list}`)
  const more =
    state.queue.length > maxShown
      ? translateWithFallback('chat.queueMore', { count: state.queue.length - maxShown }, ` [+${state.queue.length - maxShown}]`)
      : ''
  return base + more
}

// "@user, <title> added to the queue [#N]" / "@user, <title> added, playing now" - confirmation of an accepted Channel Points request
export function buildRedemptionAcceptedMessage(userName: string, added: { song: { title: string }; started: boolean; position: number }): string {
  const params = { user: userName, title: truncate(added.song.title), position: added.position }

  return added.started
    ? translateWithFallback('chat.redemption.acceptedNowPlaying', params, `@${userName}, ${params.title} added, playing now`)
    : translateWithFallback('chat.redemption.accepted', params, `@${userName}, ${params.title} added to the queue [#${added.position}]`)
}

// "@user, <reason>, points refunded" - one message per FailureReason, shared by the Channel Points
// redemption flow (request rejected, or a later playback failure) wherever it needs to notify chat
export function buildRedemptionRejectionMessage(userName: string, reason: FailureReason): string {
  // only a playback failure names the track (the one that could not be played); a request that was never queued has none
  const title = typeof reason.params?.title === 'string' ? truncate(reason.params.title) : undefined
  const params = { user: userName, ...reason.params, ...(title && { title }) }

  return (
    t(getSettings().locale, `chat.redemption.${reason.code}`, params) ??
    translateWithFallback('chat.redemption.generic', params, `@${userName}, your request could not be completed, points refunded`)
  )
}

// Sent instead of the "points refunded" message when Twitch did not accept the cancellation: it must not promise a refund
export function buildRedemptionRefundFailedMessage(userName: string): string {
  return translateWithFallback(
    'chat.redemption.refundFailed',
    { user: userName },
    `@${userName}, your request could not be completed and the points could not be refunded automatically, the streamer will sort it out`
  )
}
