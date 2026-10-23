import type { ActivityReasonCode, ActivityStatus, FailureReason, QueueItem } from './types.js'
import { logActivity } from './activity.js'
import { t } from './i18n.js'
import { getSettings } from './settings.js'
import { createLogger, describeError } from './logger.js'

type Tracked = NonNullable<QueueItem['channelPointsRedemption']>

export type RedemptionOutcome = { status: 'succeeded' } | { status: 'failed'; reason: FailureReason }
export type ItemOutcome = 'played' | 'skipped' | FailureReason

const log = createLogger('FINISH')

// Set by the Twitch integration (if enabled): player.ts and queue.ts stay unaware of Twitch beyond this one hook,
// so everything works the same with the integration off
let handler: ((tracked: Tracked, outcome: RedemptionOutcome) => void) | null = null

export function registerRedemptionHandler(next: typeof handler): void {
  handler = next
}

type ReasonParams = Record<string, string | number>

// the journal entry a track writes when it leaves without playing through: who asked for it, what it was,
// and why it never played. `query` keeps what identifies the track (the requester typed a title, not a url).
// The entry is a record of the moment: a playlist track, which carries only a marker, is named in the
// language of that moment
function journal(item: QueueItem, status: ActivityStatus, reasonCode: ActivityReasonCode, reasonParams?: ReasonParams): void {
  logActivity({
    requestedBy: item.isFallback ? t(getSettings().locale, 'fallback.title') : item.requestedBy,
    query: item.url,
    title: item.title,
    videoId: item.videoId,
    status,
    reasonCode,
    reasonParams
  })
}

/**
 * The single place where a track leaves the queue or the player for good. The outcome owns the way out:
 * it decides the journal entry and what happens to the Channel Points redemption.
 *
 * 'played' fulfils the redemption, any reason cancels it (points refunded, requester told in chat),
 * 'skipped' leaves the reward open on Twitch for the streamer to decide. Tracks without a redemption
 * (chat requests, playlist tracks) skip the reward part, but the journal is written either way.
 *
 * The track owns its reward: once closed it is gone from the track, so no other path can close it again.
 */
export function finishItem(item: QueueItem | null | undefined, outcome: ItemOutcome): void {
  if (!item) return

  if (outcome === 'skipped') {
    // the streamer or a moderator skipped the track on purpose: the reward stays UNFULFILLED on Twitch
    // with the points held, and this entry is where that can be seen
    if (item.channelPointsRedemption) {
      log.warn(`"${item.title}" was bought with Channel Points: the reward stays UNFULFILLED on Twitch until it is fulfilled or refunded there`)
      journal(item, 'skipped', 'REWARD_NOT_REFUNDED')
    }
    return
  }

  if (typeof outcome === 'object') {
    // a block is a refusal; a playback error is a failure. A removal or a cleared queue is the streamer's
    // own doing, and the chat reply already tells the requester, so the journal stays quiet about those
    if (outcome.code === 'BLOCKED') journal(item, 'rejected', outcome.code, outcome.params)
    else if (outcome.code !== 'TRACK_REMOVED' && outcome.code !== 'QUEUE_CLEARED') journal(item, 'failed', outcome.code, outcome.params)
  }

  const tracked = item.channelPointsRedemption
  if (!tracked) return

  // the track owns its reward: once closed it is gone from the track, so no other path can close it again
  delete item.channelPointsRedemption

  // the chat reply names the track, whatever reason the caller knew about
  const result: RedemptionOutcome =
    outcome === 'played' ? { status: 'succeeded' } : { status: 'failed', reason: { ...outcome, params: { title: item.title, ...outcome.params } } }

  try {
    handler?.(tracked, result)
  } catch (error) {
    log.error(`redemption handler failed for ${tracked.id}: ${describeError(error)}`)
  }
}
