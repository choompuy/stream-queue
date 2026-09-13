import { ActivityEntry } from './types.js'

const ACTIVITY_LIMIT = 30
const activityLog: ActivityEntry[] = []

function log(message: string): void {
  console.log(`[ACTIVITY] ${message}`)
}

export function logActivity(entry: Omit<ActivityEntry, 'at'>): void {
  activityLog.unshift({ ...entry, at: Date.now() })
  if (activityLog.length > ACTIVITY_LIMIT) {
    activityLog.length = ACTIVITY_LIMIT
  }
}

export function getActivity(): ActivityEntry[] {
  return [...activityLog]
}

export function clearActivity(): void {
  activityLog.length = 0
  log('cleared')
}
