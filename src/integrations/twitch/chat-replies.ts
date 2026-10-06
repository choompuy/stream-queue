import { translateWithFallback, t } from '../../i18n.js'
import { getSettings } from '../../settings.js'
import { getState } from '../../player.js'
import type { PlayerState, FailureReason } from '../../types.js'

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

const REDEMPTION_REASON_FALLBACKS: Partial<Record<FailureReason['code'], string>> = {
  DUPLICATE: 'that track is already in the queue',
  BLOCKED: 'that track is blocked',
  TRACK_REMOVED: 'your track was removed from the queue',
  QUEUE_CLEARED: 'the queue was cleared',
  QUEUE_FULL: 'the queue is full',
  USER_LIMIT: 'you already have a track queued',
  INVALID_YOUTUBE_URL: 'that is not a valid YouTube link',
  SONG_NOT_FOUND: 'no matching track was found',
  NOT_MUSIC: 'that video is not categorized as music',
  NOT_PUBLIC: 'that video is not public',
  NOT_EMBEDDABLE: 'that video cannot be embedded',
  AGE_RESTRICTED: 'that video is age-restricted',
  REGION_BLOCKED: 'that video is not available in this region',
  NOT_PLAYABLE: 'that video cannot be played',
  IS_LIVE: 'live streams cannot be queued',
  IS_SHORT: 'shorts cannot be queued',
  DURATION_OUT_OF_RANGE: 'that track does not meet the length requirement',
  VIEWS_TOO_LOW: 'that track does not meet the view count requirement',
  PLAYBACK_VIDEO_UNAVAILABLE: 'that video became unavailable during playback',
  PLAYBACK_EMBED_DISALLOWED: 'that video stopped allowing embedded playback',
  PLAYBACK_FAILED: 'playback failed'
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
  const fallbackReason = REDEMPTION_REASON_FALLBACKS[reason.code] ?? 'your request could not be completed'
  // only a playback failure names the track (the one that could not be played); a request that was never queued has none
  const title = typeof reason.params?.title === 'string' ? truncate(reason.params.title) : undefined
  const params = { user: userName, ...reason.params, ...(title && { title }) }
  const locale = getSettings().locale

  const specific = t(locale, `chat.redemption.${reason.code}`, params)
  if (specific) return specific

  return translateWithFallback('chat.redemption.generic', params, `@${userName}, ${fallbackReason}, points refunded`)
}

// Sent instead of the "points refunded" message when Twitch did not accept the cancellation: it must not promise a refund
export function buildRedemptionRefundFailedMessage(userName: string): string {
  return translateWithFallback(
    'chat.redemption.refundFailed',
    { user: userName },
    `@${userName}, your request could not be completed and the points could not be refunded automatically, the streamer will sort it out`
  )
}

export class ChatReplier {
  private sendMessage: (message: string) => Promise<void>
  private isChatReady: () => boolean
  private chatStart: Promise<void> | null = null
  private chatStartWaitMs = 5000

  constructor(sendMessage: (message: string) => Promise<void>, isChatReady: () => boolean) {
    this.sendMessage = sendMessage
    this.isChatReady = isChatReady
  }

  async reply(message: string): Promise<void> {
    if (!this.isChatReady() && this.chatStart) {
      await Promise.race([this.chatStart, this.wait(this.chatStartWaitMs)])
    }
    await this.sendMessage(message).catch((error) => {
      console.error(`Failed to send chat reply: ${error instanceof Error ? error.message : error}`)
    })
  }

  setChatStart(promise: Promise<void>): void {
    this.chatStart = promise
  }

  clearChatStart(): void {
    this.chatStart = null
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
