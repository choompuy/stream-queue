import { ActivityEntry, ActivityReasonCode, QueueItem } from './types.js'
import { dataPath, createFileStore } from './persist.js'
import { createLogger, describeError } from './logger.js'

const ACTIVITY_LIMIT = 100

const store = createFileStore<ActivityEntry[]>(() => dataPath('activity.json'))

// read from disk on first use, not when the module is imported
let loaded: ActivityEntry[] | null = null
const entries = (): ActivityEntry[] => (loaded ??= store.load([]))

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
}

export function getActivity(): ActivityEntry[] {
  return [...entries()]
}

export function clearActivity(): void {
  entries().length = 0
  save()
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
