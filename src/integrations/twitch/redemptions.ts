import { createLogger } from '../../infra/logger.js'
import { AppError } from '../../core/types.js'
import type { FailureReason } from '../../core/types.js'
import type { TwitchChannelPointsRedemption } from '../../core/types.js'
import { TwitchClient } from './client.js'

const log = createLogger('TWITCH REDEMPTIONS')

const REDEMPTION_RETRY_ATTEMPTS = 3
const REDEMPTION_RETRY_DELAY_MS = 1000

// A 4xx other than 429 is Twitch's final answer (the redemption was already closed by hand, the reward is gone): trying again
// three times changes nothing. A network error, a timeout, 429 and 5xx are worth another try
export function isRetryable(error: unknown): boolean {
  const status = error instanceof AppError && typeof error.params?.status === 'number' ? error.params.status : null
  return status === null || status === 429 || status >= 500
}

// Sets the status with retries and backoff. Returns whether Twitch accepted it
async function setRedemptionStatus(
  redemption: TwitchChannelPointsRedemption,
  twitchClient: TwitchClient,
  status: 'FULFILLED' | 'CANCELED'
): Promise<boolean> {
  for (let attempt = 1; attempt <= REDEMPTION_RETRY_ATTEMPTS; attempt++) {
    try {
      await twitchClient.updateRedemptionStatus(redemption, status)
      return true
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)

      if (attempt === REDEMPTION_RETRY_ATTEMPTS || !isRetryable(error)) {
        log.error(`Failed to set redemption ${redemption.id} to ${status} after ${attempt} attempt(s): ${reason}`)
        return false
      }

      const delay = REDEMPTION_RETRY_DELAY_MS * 2 ** (attempt - 1)
      log.error(
        `Failed to set redemption ${redemption.id} to ${status} (attempt ${attempt}/${REDEMPTION_RETRY_ATTEMPTS}): ${reason}. Retrying in ${delay}ms`
      )
      await wait(delay)
    }
  }

  return false
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// The track was played: refunding the points now would give the viewer the song for free.
// The redemption stays UNFULFILLED for the streamer or a moderator to close in the Twitch rewards queue
async function fulfillRedemption(redemption: TwitchChannelPointsRedemption, twitchClient: TwitchClient): Promise<void> {
  if (await setRedemptionStatus(redemption, twitchClient, 'FULFILLED')) {
    log.log(`Channel Points redemption fulfilled: ${redemption.id}`)
    return
  }

  log.error(`Redemption ${redemption.id} was played but could not be fulfilled, it is left for a manual decision`)
}

// "points refunded" goes to chat only when Twitch confirmed it: the points stay held otherwise
async function cancelRedemption(
  redemption: TwitchChannelPointsRedemption,
  twitchClient: TwitchClient,
  reason: FailureReason,
  onReply: (message: string) => Promise<void>
): Promise<void> {
  if (await setRedemptionStatus(redemption, twitchClient, 'CANCELED')) {
    log.log(`Channel Points redemption canceled (points refunded): ${redemption.id}`)
    await onReply(buildRedemptionRejectionMessage(redemption.user_name, reason))
    return
  }

  await onReply(buildRedemptionRefundFailedMessage(redemption.user_name))
}

function buildRedemptionRejectionMessage(userName: string, reason: FailureReason): string {
  const fallbackReason = REDEMPTION_REASON_FALLBACKS[reason.code] ?? 'your request could not be completed'
  const title = typeof reason.params?.title === 'string' ? truncate(reason.params.title) : undefined
  const params = { user: userName, ...reason.params, ...(title && { title }) }
  return `@${userName}, ${fallbackReason}, points refunded`
}

function buildRedemptionRefundFailedMessage(userName: string): string {
  return `@${userName}, your request could not be completed and the points could not be refunded automatically, the streamer will sort it out`
}

const truncate = (s: string, max = 40) => {
  const chars = Array.from(s)
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : s
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

export type RedemptionHandlerDeps = {
  requestSong: (query: string, userName: string, skipValidation: boolean, redemption: { id: string; rewardId: string; userName: string }) => Promise<{ outcome: string; added?: { song: { title: string }; started: boolean; position: number }; reason?: FailureReason }>
  buildAcceptedMessage: (userName: string, added: { song: { title: string }; started: boolean; position: number }) => string
}

export class RedemptionHandler {
  private client: TwitchClient
  private onReply: (message: string) => Promise<void>
  private deps: RedemptionHandlerDeps
  private processedIds = new Set<string>()

  constructor(client: TwitchClient, onReply: (message: string) => Promise<void>, deps: RedemptionHandlerDeps) {
    this.client = client
    this.onReply = onReply
    this.deps = deps
  }

  async handle(event: TwitchChannelPointsRedemption, configuredRewardId: string | null): Promise<void> {
    if (!configuredRewardId || event.reward.id !== configuredRewardId) {
      log.log(`Ignoring redemption with non-matching reward ID: ${event.reward.id} (configured: ${configuredRewardId || 'none'})`)
      return
    }

    if (this.processedIds.has(event.id)) {
      log.log(`Ignoring duplicate redemption: ${event.id}`)
      return
    }

    this.processedIds.add(event.id)

    // Clean up old IDs after a while to prevent unbounded growth
    if (this.processedIds.size > 1000) {
      const idsArray = Array.from(this.processedIds)
      this.processedIds = new Set(idsArray.slice(500))
    }

    log.log(`Channel Points redemption: ${event.reward.title} by ${event.user_name}`)

    const query = event.user_input.trim()
    if (!query) {
      log.error(`Empty song request in redemption: ${event.id}`)
      await this.cancel(event, { code: 'SONG_NOT_FOUND' })
      return
    }

    const result = await this.deps.requestSong(query, event.user_name, false, {
      id: event.id,
      rewardId: event.reward.id,
      userName: event.user_name
    })

    if (result.outcome !== 'added') {
      const reason: FailureReason =
        result.outcome === 'invalid-url' ? { code: 'INVALID_YOUTUBE_URL' } : result.outcome === 'not-found' ? { code: 'SONG_NOT_FOUND' } : result.reason!

      log.error(`Song request failed for redemption ${event.id}: ${result.outcome}`)
      await this.cancel(event, reason)
      return
    }

    log.log(`Redemption ${event.id} added to queue`)
    await this.onReply(this.deps.buildAcceptedMessage(event.user_name, result.added!))
  }

  async fulfill(redemption: TwitchChannelPointsRedemption): Promise<void> {
    await fulfillRedemption(redemption, this.client)
  }

  async cancel(redemption: TwitchChannelPointsRedemption, reason: FailureReason): Promise<void> {
    await cancelRedemption(redemption, this.client, reason, this.onReply)
  }

  clearProcessed(): void {
    this.processedIds.clear()
  }
}
