import { ActivityEntry, ActivityReasonCode } from './types.js'
import { QueueItem } from '../queue/types.js'
import { ACTIVITY_PATH, createFileStore } from '../../infrastructure/persistence/file-store.js'

const ACTIVITY_LIMIT = 100

const store = createFileStore<ActivityEntry[]>(ACTIVITY_PATH)
let activityLog: ActivityEntry[] = store.load([])

function log(message: string): void {
  console.log(`[ACTIVITY] ${message}`)
}

function save(): void {
  store.scheduleSave(
    () => activityLog,
    (error) => console.error('[ACTIVITY] Failed to save:', error instanceof Error ? error.message : error)
  )
}

export function logActivity(entry: Omit<ActivityEntry, 'at'>): void {
  activityLog.unshift({ ...entry, at: Date.now() })
  if (activityLog.length > ACTIVITY_LIMIT) {
    activityLog.length = ACTIVITY_LIMIT
  }
  save()
}

export function getActivity(): ActivityEntry[] {
  return [...activityLog]
}

export function clearActivity(): void {
  activityLog.length = 0
  save()
  log('cleared')
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
    query: item.title,
    title: item.title,
    videoId: item.videoId,
    status: 'failed',
    reasonCode,
    reasonParams
  })
}
