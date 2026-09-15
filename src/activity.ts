import { ActivityEntry } from './types.js'
import { ACTIVITY_PATH, createFileStore } from './persist.js'

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
