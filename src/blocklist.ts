import { INPUT_LIMITS } from './validate.js'
import { dataPath, createListStore } from './persist.js'
import { createLogger } from './logger.js'
import { isValidVideoId } from './youtube/url.js'
import type { Blockable } from './types.js'

export type BlockedTrack = {
  videoId: string
  title: string
  blockedAt: number
}

// Entries older than the limit are dropped, which makes an old blocked track requestable again, so the limit is high and the drop is logged
const BLOCKLIST_LIMIT = 1000

const log = createLogger('BLOCKLIST')

function isBlockedTrack(value: unknown): value is BlockedTrack {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>

  return isValidVideoId(v.videoId) && typeof v.title === 'string' && Number.isFinite(v.blockedAt)
}

const blocked = createListStore<BlockedTrack>({
  file: () => dataPath('blocklist.json'),
  guard: isBlockedTrack,
  limit: BLOCKLIST_LIMIT,
  topics: ['blocklist', 'state']
})

let ids: Set<string> | null = null

function refreshIds(list: BlockedTrack[]): void {
  ids = new Set(list.map((track) => track.videoId))
}

const idSet = (): Set<string> => (ids ??= new Set(blocked.all().map((track) => track.videoId)))

export function getBlockedTracks(): BlockedTrack[] {
  return blocked.all()
}

export function isBlocked(videoId: string): boolean {
  return idSet().has(videoId)
}

// What the panel gets: every track says whether it is blocked, so the panel does not have to match lists
export function markBlocked<T extends { videoId: string }>(tracks: T[]): Blockable<T>[] {
  return tracks.map((track) => ({ ...track, isBlocked: isBlocked(track.videoId) }))
}

export function blockTrack(videoId: string, title: string): BlockedTrack {
  blocked.update((list) => {
    if (!list.some((track) => track.videoId === videoId)) {
      list.unshift({ videoId, title: title.trim().slice(0, INPUT_LIMITS.blocklistTitle) || videoId, blockedAt: Date.now() })

      if (list.length > BLOCKLIST_LIMIT) {
        const dropped = list.splice(BLOCKLIST_LIMIT)
        log.warn(`Limit of ${BLOCKLIST_LIMIT} reached, ${dropped.length} oldest block(s) dropped`)
      }
    }
    refreshIds(list)
  })

  return blocked.all().find((track) => track.videoId === videoId)!
}

export function unblockTrack(videoId: string): boolean {
  let removed = false

  blocked.update((list) => {
    const index = list.findIndex((track) => track.videoId === videoId)
    if (index >= 0) {
      list.splice(index, 1)
      removed = true
    }
    refreshIds(list)
  })

  return removed
}
