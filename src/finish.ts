import type { FailureReason, QueueItem } from './types.js'
import { createLogger, describeError } from './logger.js'

type Tracked = NonNullable<QueueItem['channelPointsRedemption']>

export type RedemptionOutcome = { status: 'succeeded' } | { status: 'failed'; reason: FailureReason }
export type ItemOutcome = 'played' | FailureReason

const log = createLogger('FINISH')

// Set by the Twitch integration (if enabled): player.ts and queue.ts stay unaware of Twitch beyond this one hook,
// so everything works the same with the integration off
let handler: ((tracked: Tracked, outcome: RedemptionOutcome) => void) | null = null

export function registerRedemptionHandler(next: typeof handler): void {
  handler = next
}

// A redemption is closed once: whatever path ends a track (played, failed, skipped, removed, cleared, blocked)
// must not be able to close it a second time
const CLOSED_LIMIT = 500
const closed = new Set<string>()

let onClosedChange: (() => void) | null = null

/** Called every time a redemption is closed, so that whoever saves the state can write it at once. */
export function registerClosedChangeListener(listener: (() => void) | null): void {
  onClosedChange = listener
}

export function getClosedRedemptionIds(): string[] {
  return [...closed]
}

export function restoreClosedRedemptions(ids: string[]): void {
  for (const id of ids) closed.add(id)
  while (closed.size > CLOSED_LIMIT) closed.delete(closed.values().next().value as string)
}

function markClosed(id: string): boolean {
  if (closed.has(id)) return false

  closed.add(id)
  if (closed.size > CLOSED_LIMIT) closed.delete(closed.values().next().value as string)
  return true
}

/**
 * The single place where a track leaves the queue or the player for good.
 * 'played' fulfils its Channel Points redemption, any FailureReason cancels it (points refunded, requester told in chat).
 * Tracks without a redemption (chat requests, playlist tracks) are ignored.
 */
export function finishItem(item: QueueItem | null | undefined, outcome: ItemOutcome): void {
  const tracked = item?.channelPointsRedemption
  if (!item || !tracked) return

  if (!markClosed(tracked.id)) {
    log.warn(`redemption ${tracked.id} was already closed, ignored`)
    return
  }

  try {
    onClosedChange?.()
  } catch (error) {
    log.error(`could not save the closed redemption ${tracked.id}: ${describeError(error)}`)
  }

  const result: RedemptionOutcome =
    outcome === 'played' ? { status: 'succeeded' } : { status: 'failed', reason: { ...outcome, params: { title: item.title, ...outcome.params } } }

  try {
    handler?.(tracked, result)
  } catch (error) {
    log.error(`redemption handler failed for ${tracked.id}: ${describeError(error)}`)
  }
}
