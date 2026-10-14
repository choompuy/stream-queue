import { dataPath, createFileStore, loadList } from './persist.js'
import { createLogger, describeError } from './logger.js'
import { isValidVideoId } from './youtube/url.js'
import { emit } from './state-events.js'
import type { Blockable } from './types.js'

export type BlockedTrack = {
  videoId: string
  title: string
  blockedAt: number
}

// Entries older than the limit are dropped, which makes an old blocked track requestable again, so the limit is high and the drop is logged
const BLOCKLIST_LIMIT = 1000
const TITLE_MAX_LENGTH = 200

const log = createLogger('BLOCKLIST')
const store = createFileStore<BlockedTrack[]>(() => dataPath('blocklist.json'))

function isBlockedTrack(value: unknown): value is BlockedTrack {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>

  return isValidVideoId(v.videoId) && typeof v.title === 'string' && Number.isFinite(v.blockedAt)
}

// read from disk on first use, not when the module is imported
let blocked: BlockedTrack[] | null = null
let blockedIds: Set<string> | null = null

function ensureLoaded(): { list: BlockedTrack[]; ids: Set<string> } {
  if (!blocked || !blockedIds) {
    blocked = loadList(store, isBlockedTrack)
    blockedIds = new Set(blocked.map((t) => t.videoId))
  }
  return { list: blocked, ids: blockedIds }
}

function save(): void {
  store.scheduleSave(
    () => ensureLoaded().list,
    (error) => log.error(`Failed to save: ${describeError(error)}`)
  )
}

export function getBlockedTracks(): BlockedTrack[] {
  return [...ensureLoaded().list]
}

export function isBlocked(videoId: string): boolean {
  return ensureLoaded().ids.has(videoId)
}

// What the panel gets: every track says whether it is blocked, so the panel does not have to match lists
export function markBlocked<T extends { videoId: string }>(tracks: T[]): Blockable<T>[] {
  return tracks.map((track) => ({ ...track, isBlocked: isBlocked(track.videoId) }))
}

// a blocked track changes the queue (it is skipped), the playlist (it is not played) and the list of blocked tracks
function changed(): void {
  emit('blocklist')
  emit('state')
  emit('fallback')
}

export function blockTrack(videoId: string, title: string): BlockedTrack {
  const { list, ids } = ensureLoaded()

  if (!ids.has(videoId)) {
    const safeTitle = title.trim().slice(0, TITLE_MAX_LENGTH) || videoId
    list.unshift({ videoId, title: safeTitle, blockedAt: Date.now() })
    ids.add(videoId)

    if (list.length > BLOCKLIST_LIMIT) {
      const dropped = list.splice(BLOCKLIST_LIMIT)
      for (const removed of dropped) ids.delete(removed.videoId)
      log.warn(`Limit of ${BLOCKLIST_LIMIT} reached, ${dropped.length} oldest block(s) dropped`)
    }

    save()
    changed()
  }
  return list.find((t) => t.videoId === videoId)!
}

export function unblockTrack(videoId: string): boolean {
  const { list, ids } = ensureLoaded()
  const before = list.length
  blocked = list.filter((t) => t.videoId !== videoId)
  ids.delete(videoId)

  if (blocked.length !== before) {
    save()
    changed()
    return true
  }

  return false
}
