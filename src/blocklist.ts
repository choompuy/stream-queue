import { BLOCKLIST_PATH, createFileStore } from './persist.js'

export type BlockedTrack = {
  videoId: string
  title: string
  blockedAt: number
}

const store = createFileStore<BlockedTrack[]>(BLOCKLIST_PATH)
let blocked: BlockedTrack[] = store.load([])
const blockedIds = new Set(blocked.map((t) => t.videoId))

function save(): void {
  store.scheduleSave(
    () => blocked,
    (error) => console.error('[BLOCKLIST] Failed to save:', error instanceof Error ? error.message : error)
  )
}

export function getBlockedTracks(): BlockedTrack[] {
  return [...blocked]
}

export function isBlocked(videoId: string): boolean {
  return blockedIds.has(videoId)
}

export function blockTrack(videoId: string, title: string): BlockedTrack {
  if (!blockedIds.has(videoId)) {
    blocked.unshift({ videoId, title, blockedAt: Date.now() })
    blockedIds.add(videoId)
    save()
  }
  return blocked.find((t) => t.videoId === videoId)!
}

export function unblockTrack(videoId: string): boolean {
  const before = blocked.length
  blocked = blocked.filter((t) => t.videoId !== videoId)
  blockedIds.delete(videoId)

  if (blocked.length !== before) {
    save()
    return true
  }

  return false
}
