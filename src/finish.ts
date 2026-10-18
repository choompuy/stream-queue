import { AppError, QueueItem } from './types.js'
import { createLogger, describeError } from './logger.js'

type Tracked = NonNullable<QueueItem['channelPointsRedemption']>

export type RedemptionOutcome = { status: 'succeeded' } | { status: 'failed'; reason: AppError }
export type ItemOutcome = 'played' | AppError

const log = createLogger('FINISH')

// Set by the Twitch integration (if enabled): player.ts and queue.ts stay unaware of Twitch beyond this one hook,
// so everything works the same with the integration off
let handler: ((tracked: Tracked, outcome: RedemptionOutcome) => void) | null = null

export function registerRedemptionHandler(next: typeof handler): void {
  handler = next
}

/**
 * The single place where a track leaves the queue or the player for good.
 * 'played' fulfils its Channel Points redemption, any thrown reason cancels it (points refunded, requester told in chat).
 * Tracks without a redemption (chat requests, playlist tracks) are ignored.
 *
 * The track owns its reward: once closed it is gone from the track, so no other path can close it again.
 */
export function finishItem(item: QueueItem | null | undefined, outcome: ItemOutcome): void {
  const tracked = item?.channelPointsRedemption
  if (!item || !tracked) return

  // the track owns its reward: once closed it is gone from the track, so no other path can close it again
  delete item.channelPointsRedemption

  // the chat reply names the track, whatever reason the caller knew about
  const reason = outcome === 'played' ? null : new AppError(outcome.code, outcome.message, { title: item.title, ...outcome.params })
  const result: RedemptionOutcome = reason ? { status: 'failed', reason } : { status: 'succeeded' }

  try {
    handler?.(tracked, result)
  } catch (error) {
    log.error(`redemption handler failed for ${tracked.id}: ${describeError(error)}`)
  }
}
