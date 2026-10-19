import { ActivityEntry, ActivityReasonCode } from './types.js'
import { dataPath, createFileStore, loadList } from './persist.js'
import { createLogger } from './logger.js'
import { createStore } from './store.js'

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

const changes = createStore({
  read: entries,
  topics: ['activity'],
  save: () => store.scheduleSave(entries)
})

export function logActivity(entry: Omit<ActivityEntry, 'at'>): void {
  changes.update(() => {
    const list = entries()
    list.unshift({ ...entry, at: Date.now() })
    if (list.length > ACTIVITY_LIMIT) {
      list.length = ACTIVITY_LIMIT
    }
  })
}

export function getActivity(): ActivityEntry[] {
  return [...entries()]
}

export function clearActivity(): void {
  changes.update(() => {
    entries().length = 0
  })
  log.log('cleared')
}

type ReasonParams = Record<string, string | number>

export function logRejection(
  requestedBy: string,
  query: string,
  reasonCode: ActivityReasonCode,
  options: { title?: string | null; videoId?: string | null; reasonParams?: ReasonParams } = {}
): void {
  log.log(`[REJECT] ${requestedBy} → ${reasonCode}`)
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
