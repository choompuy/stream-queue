import { ActivityEntry, ActivityReasonCode } from './types.js'
import { dataPath, createListStore } from './persist.js'
import { createLogger } from './logger.js'

const ACTIVITY_LIMIT = 100

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

const log = createLogger('ACTIVITY')

const entries = createListStore<ActivityEntry>({
  file: () => dataPath('activity.json'),
  guard: isActivityEntry,
  limit: ACTIVITY_LIMIT,
  topics: ['activity']
})

/** Appends one line to the journal. Returns the moment of the entry: the key it can be found by again (the outage line of the Twitch integration corrects itself with it). */
export function logActivity(entry: Omit<ActivityEntry, 'at'>): number {
  const at = Date.now()
  entries.update((list) => {
    list.unshift({ ...entry, at })
    if (list.length > ACTIVITY_LIMIT) list.length = ACTIVITY_LIMIT
  })
  return at
}

/** Reworks the reasonParams of one line: the outage entry states its minutes while the outage is still going on, and learns the real length when the connection returns. */
export function updateActivityReasonParams(at: number, reasonParams: ReasonParams): void {
  entries.update((list) => {
    const entry = list.find((entry) => entry.at === at)
    if (entry) entry.reasonParams = { ...entry.reasonParams, ...reasonParams }
  })
}

export function getActivity(): ActivityEntry[] {
  return entries.all()
}

export function clearActivity(): void {
  entries.update((list) => {
    list.length = 0
  })
  log.info('cleared')
}

type ReasonParams = Record<string, string | number>

export function logRejection(
  requestedBy: string,
  query: string,
  reasonCode: ActivityReasonCode,
  options: { title?: string | null; videoId?: string | null; reasonParams?: ReasonParams } = {}
): void {
  log.info(`[REJECT] ${requestedBy} → ${reasonCode}`)
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
