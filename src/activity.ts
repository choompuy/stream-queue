import { ActivityEntry, ActivityReasonCode, QueueItem } from './types.js'
import { dataPath, createFileStore, loadList } from './persist.js'
import { createLogger, describeError } from './logger.js'
import { emit } from './state-events.js'

const ACTIVITY_LIMIT = 100

const store = createFileStore<ActivityEntry[]>(() => dataPath('activity.json'))

const isNullableString = (value: unknown): boolean => value === null || typeof value === 'string'

function isActivityEntry(value: unknown): value is ActivityEntry {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>

  return (
    typeof v.requestedBy === 'string' &&
    typeof v.query === 'string' &&
    isNullableString(v.title) &&
    isNullableString(v.videoId) &&
    typeof v.status === 'string' &&
    isNullableString(v.reasonCode) &&
    (v.reasonParams === undefined || (typeof v.reasonParams === 'object' && v.reasonParams !== null)) &&
    Number.isFinite(v.at)
  )
}

// read from disk on first use, not when the module is imported; a file that grew past the limit is cut to it
let loaded: ActivityEntry[] | null = null
const entries = (): ActivityEntry[] => (loaded ??= loadList(store, isActivityEntry).slice(0, ACTIVITY_LIMIT))

const log = createLogger('ACTIVITY')

function save(): void {
  store.scheduleSave(
    () => entries(),
    (error) => log.error(`Failed to save: ${describeError(error)}`)
  )
}

export function logActivity(entry: Omit<ActivityEntry, 'at'>): void {
  const list = entries()
  list.unshift({ ...entry, at: Date.now() })
  if (list.length > ACTIVITY_LIMIT) {
    list.length = ACTIVITY_LIMIT
  }
  save()
  emit('activity')
}

export function getActivity(): ActivityEntry[] {
  return [...entries()]
}

export function clearActivity(): void {
  entries().length = 0
  save()
  emit('activity')
  log.log('cleared')
}

type ReasonParams = Record<string, string | number>

export function logRejection(
  requestedBy: string,
  query: string,
  reasonCode: ActivityReasonCode,
  options: { title?: string | null; videoId?: string | null; reasonParams?: ReasonParams } = {}
): void {
  logActivity({
    requestedBy,
    query,
    title: options.title ?? null,
    videoId: options.videoId ?? null,
    status: 'rejected',
    reasonCode,
    reasonParams: options.reasonParams
  })
}

export function logAcceptance(requestedBy: string, query: string, title: string, videoId: string): void {
  logActivity({ requestedBy, query, title, videoId, status: 'accepted', reasonCode: null })
}

/**
 * A track bought with Channel Points was skipped. Skipping does not touch the reward (the streamer or a moderator decides):
 * it stays UNFULFILLED on Twitch with the points held, and this entry is where that can be seen.
 */
export function logSkippedWithOpenReward(item: QueueItem): void {
  logActivity({
    requestedBy: item.requestedBy,
    query: item.url,
    title: item.title,
    videoId: item.videoId,
    status: 'skipped',
    reasonCode: 'REWARD_NOT_REFUNDED'
  })
}

export function logFailure(item: QueueItem, reasonCode: ActivityReasonCode, reasonParams?: ReasonParams): void {
  logActivity({
    requestedBy: item.requestedBy,
    query: item.url,
    title: item.title,
    videoId: item.videoId,
    status: 'failed',
    reasonCode,
    reasonParams
  })
}
