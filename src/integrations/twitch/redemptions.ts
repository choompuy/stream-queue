import { setTimeout as sleep } from 'node:timers/promises'
import type { TwitchClient } from './client.js'
import type { TwitchChannelPointsRedemption } from './types.js'
import { getRuntime, getTunables } from './state.js'
import { replyInChat } from './chat-reply.js'
import { isRetryable } from './error.js'
import { detachChannelPointsRedemptions } from '../../queue.js'
import { requestSong } from '../../request.js'
import {
  buildRedemptionAcceptedMessage,
  buildRedemptionRejectionMessage,
  buildRedemptionRefundFailedMessage
} from '../../chat-replies.js'
import { getTwitchConfig } from './config.js'
import { getSettings } from '../../settings.js'
import { notify } from '../../state-events.js'
import { AppError, type AddedSong, type FailureReason } from '../../types.js'
import type { QueueItem } from '../../types.js'
import { createLogger, describeError } from '../../logger.js'
import type { RedemptionOutcome } from '../../finish.js'

// The channel points pipeline: a redemption of the configured reward buys one song request,
// which is then fulfilled or refunded with the track's playback outcome. The lifecycle in
// index.ts wires this module to EventSub (incoming redemptions) and to the queue (the
// playback outcome of a queued track).

const log = createLogger('TWITCH')

const REDEMPTION_RETRY_ATTEMPTS = 3

// the ids of the redemptions handled so far (the latest ones only)
const HANDLED_REDEMPTIONS_LIMIT = 500
const handledRedemptions = new Set<string>()

// what is kept with a queued track about the redemption that paid for it
export type TrackedRedemption = NonNullable<QueueItem['channelPointsRedemption']>

const trackRedemption = (event: TwitchChannelPointsRedemption): TrackedRedemption => ({
  id: event.id,
  rewardId: event.reward.id,
  userName: event.user_name
})

/** Reacts to the playback outcome of a track that a redemption paid for: fulfill it, or refund it with the reason. */
export function handleChannelPointsPlaybackOutcome(tracked: TrackedRedemption, outcome: RedemptionOutcome, twitchClient: TwitchClient): void {
  if (outcome.status === 'failed') {
    void cancelRedemption(tracked, twitchClient, outcome.reason)
    return
  }

  if (!getTwitchConfig().autoFulfillRedemptions) {
    log.info(`Redemption ${tracked.id} finished playback, left unfulfilled (auto-fulfill disabled)`)
    return
  }

  void fulfillRedemption(tracked, twitchClient)
}

/** Handles one delivered redemption: a matching, unseen request is turned into a song request. */
export async function handleChannelPointsRedemption(event: TwitchChannelPointsRedemption, twitchClient: TwitchClient): Promise<void> {
  const configuredRewardId = getTwitchConfig().channelPointsRewardId
  if (!configuredRewardId || event.reward.id !== configuredRewardId) {
    // the subscription sees every redemption of the channel, most are other rewards' business
    log.debug(`Ignoring redemption with non-matching reward ID: ${event.reward.id} (configured: ${configuredRewardId || 'none'})`)
    return
  }

  // a repeated delivery of the same redemption must not take the points twice
  if (handledRedemptions.has(event.id)) {
    log.info(`Ignoring redemption ${event.id}: it was already handled`)
    return
  }
  handledRedemptions.add(event.id)
  if (handledRedemptions.size > HANDLED_REDEMPTIONS_LIMIT) handledRedemptions.delete(handledRedemptions.values().next().value as string)

  log.info(`Channel Points redemption: ${event.reward.title} by ${event.user_name}`)

  const tracked = trackRedemption(event)

  const query = event.user_input.trim()
  if (!query) {
    log.warn(`Empty song request in redemption: ${event.id}`)
    await cancelRedemption(tracked, twitchClient, { code: 'SONG_NOT_FOUND' })
    return
  }

  let added: AddedSong
  try {
    // only the request itself: past this point the track is queued and the points are spent, so a later
    // failure must not refund them (the track would play for free and close a refunded reward)
    added = await requestSong(query, event.user_name, { channelPointsRedemption: tracked })
  } catch (error) {
    // a refusal (a duplicate, a limit, a filter) is routine: the points go back and the viewer is told why.
    // Anything else is an outage: this catch is the only place its details are logged
    if (error instanceof AppError) {
      log.warn(`Song request failed for redemption ${event.id}: ${describeError(error)}`)
    } else {
      log.error(`Song request failed for redemption ${event.id}: ${describeError(error, true)}`)
    }

    const reason: FailureReason = error instanceof AppError ? error : { code: 'SERVER_ERROR' }
    await cancelRedemption(tracked, twitchClient, reason)
    return
  }

  notify({ type: 'viewerRequest', user: event.user_name, title: added.song.title })

  // The account can be disconnected while the song is being looked up. The track is queued by now, but there is
  // no login left to close the redemption with, so it is left for the streamer like the others
  if (!getRuntime()?.oauth.isAuthenticated()) {
    const detached = detachChannelPointsRedemptions()
    log.warn(`Twitch was disconnected while redemption ${event.id} was being handled: ${detached} queued redemption(s) stay UNFULFILLED on Twitch`)
    return
  }

  log.info(`Redemption ${event.id} added to queue`)
  const locale = getSettings().locale
  await replyInChat(buildRedemptionAcceptedMessage(event.user_name, added, locale))
}

// Twitch answers 404 when there is no UNFULFILLED redemption with that id: the streamer already closed it in the rewards
// queue, or the reward was deleted. (A 400 means the request itself is wrong, so it stays a failure)
const isNoLongerOpen = (error: unknown): boolean => error instanceof AppError && error.params?.status === 404

type RedemptionUpdate = 'done' | 'no-longer-open' | 'failed'

// Sets the status with retries and backoff. Returns whether Twitch accepted it
async function setRedemptionStatus(
  redemption: TrackedRedemption,
  twitchClient: TwitchClient,
  status: 'FULFILLED' | 'CANCELED'
): Promise<RedemptionUpdate> {
  for (let attempt = 1; attempt <= REDEMPTION_RETRY_ATTEMPTS; attempt++) {
    try {
      await twitchClient.updateRedemptionStatus(redemption, status)
      return 'done'
    } catch (error) {
      const reason = describeError(error)

      if (isNoLongerOpen(error)) {
        log.info(
          `Redemption ${redemption.id} is not open any more (closed in the Twitch rewards queue, or its reward was deleted): ${status} not needed`
        )
        return 'no-longer-open'
      }

      if (attempt === REDEMPTION_RETRY_ATTEMPTS || !isRetryable(error)) {
        log.error(`Failed to set redemption ${redemption.id} to ${status} after ${attempt} attempt(s): ${reason}`)
        return 'failed'
      }

      const delay = getTunables().retryDelayMs * 2 ** (attempt - 1)
      // an intermediate failure of a retryable kind is an expected hiccup on the way, not an error;
      // the final failure below is the one that is an error
      log.warn(
        `Failed to set redemption ${redemption.id} to ${status} (attempt ${attempt}/${REDEMPTION_RETRY_ATTEMPTS}): ${reason}. Retrying in ${delay}ms`
      )
      await sleep(delay)
    }
  }

  return 'failed'
}

/** Marks a played redemption FULFILLED; one that cannot be set is left for a manual decision, never refunded. */
export async function fulfillRedemption(redemption: TrackedRedemption, twitchClient: TwitchClient): Promise<void> {
  const result = await setRedemptionStatus(redemption, twitchClient, 'FULFILLED')

  if (result === 'done') {
    log.info(`Channel Points redemption fulfilled: ${redemption.id}`)
    return
  }

  // already closed by the streamer: nothing is left to do or to worry about
  if (result === 'no-longer-open') return

  // The track was played: refunding the points now would give the viewer the song for free.
  // The redemption stays UNFULFILLED for the streamer or a moderator to close in the Twitch rewards queue
  log.error(`Redemption ${redemption.id} was played but could not be fulfilled, it is left for a manual decision`)
}

/** Refunds a redemption (CANCELED on Twitch) and tells the viewer why; a refund Twitch did not confirm is reported as failed. */
export async function cancelRedemption(redemption: TrackedRedemption, twitchClient: TwitchClient, reason: FailureReason): Promise<void> {
  const result = await setRedemptionStatus(redemption, twitchClient, 'CANCELED')

  // "points refunded" goes to chat only when Twitch confirmed it: the points stay held otherwise
  if (result === 'done') {
    log.info(`Channel Points redemption canceled (points refunded): ${redemption.id}`)
    const locale = getSettings().locale
    await replyInChat(buildRedemptionRejectionMessage(redemption.userName, reason, locale))
    return
  }

  // Closed by the streamer in the meantime: whatever they chose (refund or accept) is already done, and either
  // message here ("refunded" or "could not be refunded") could be wrong. Nothing is said in chat
  if (result === 'no-longer-open') return

  const locale = getSettings().locale
  await replyInChat(buildRedemptionRefundFailedMessage(redemption.userName, locale))
}

/** Forgets the seen redemption ids: stop() clears them when the integration is torn down. */
export function resetHandledRedemptions(): void {
  handledRedemptions.clear()
}
