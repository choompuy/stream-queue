import { t, hasKey } from './i18n.js'
import { type Blockable, type FailureReason, type PlayerState, type QueueItem } from './types.js'

const truncate = (s: string, max = 40) => {
  const chars = Array.from(s)
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : s
}

// "Now playing: X (requested by Y)" / "Nothing is playing right now" - shared by the HTTP chat endpoint and the Twitch chat module
export function buildNowPlayingMessage(state: PlayerState, locale: string): string {
  if (!state.current) {
    return t(locale, 'chat.nothingPlaying')
  }

  // a track can come without a title (YouTube gave none): the chat sees the localized placeholder, not a blank gap
  const title = state.current.title || t(locale, 'common.unknownTitle')
  const requester = state.current.isFallback ? t(locale, 'fallback.title') : state.current.requestedBy
  const base = t(locale, 'chat.nowPlayingWithRequester', { title, requestedBy: requester })
  const pausedSuffix = state.isPaused ? t(locale, 'chat.pausedSuffix') : ''
  return base + pausedSuffix
}

// "Track skipped. Now playing: X" / "Track skipped" - shared by the HTTP player route and the Twitch chat module
export function buildSkipMessage(state: PlayerState, locale: string): string {
  return state.current?.title ? t(locale, 'chat.skippedNowPlaying', { title: state.current.title }) : t(locale, 'chat.skipped')
}

// "Queue [N]: 1. Title | 2. Title ... [+more]" / "The queue is empty" - shared by the HTTP chat endpoint and the Twitch chat module.
// Blocked tracks are not upcoming: they are closed when their turn comes, so they are neither shown nor counted
export function buildQueueMessage(state: { queue: Blockable<QueueItem>[] }, locale: string): string {
  const upcoming = state.queue.filter((item) => !item.isBlocked)

  if (upcoming.length === 0) {
    return t(locale, 'chat.queueEmpty')
  }

  const maxShown = 4

  const list = upcoming
    .slice(0, maxShown)
    .map((item, i) => `${i + 1}. ${truncate(item.title)}`)
    .join(' | ')
  const base = t(locale, 'chat.queueList', { count: upcoming.length, list })
  const more = upcoming.length > maxShown ? t(locale, 'chat.queueMore', { count: upcoming.length - maxShown }) : ''
  return base + more
}

// "@user, <title> added to the queue [#N]" / "@user, <title> added, playing now" - confirmation of an accepted Channel Points request
export function buildRedemptionAcceptedMessage(
  userName: string,
  added: { song: { title: string }; started: boolean; position: number },
  locale: string
): string {
  const params = { user: userName, title: truncate(added.song.title), position: added.position }

  return added.started ? t(locale, 'chat.redemption.acceptedNowPlaying', params) : t(locale, 'chat.redemption.accepted', params)
}

// "@user, <reason>, points refunded" - one message per refusal reason, shared by the Channel Points
// redemption flow (request rejected, or a later playback failure) wherever it needs to notify chat
export function buildRedemptionRejectionMessage(userName: string, reason: FailureReason, locale: string): string {
  // only a playback failure names the track (the one that could not be played); a request that was never queued has none
  const title = typeof reason.params?.title === 'string' ? truncate(reason.params.title) : undefined
  const params = { user: userName, ...reason.params, ...(title && { title }) }

  const key = `chat.redemption.${reason.code}`
  // an explicit check: a template that resolves is allowed to start with the same words as the key
  if (!hasKey(locale, key)) return t(locale, 'chat.redemption.generic', params)
  return t(locale, key, params)
}

// Sent instead of the "points refunded" message when Twitch did not accept the cancellation: it must not promise a refund
export function buildRedemptionRefundFailedMessage(userName: string, locale: string): string {
  return t(locale, 'chat.redemption.refundFailed', { user: userName })
}
