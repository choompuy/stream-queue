import { Song, FilterFailureReason } from '../types.js'

export const CACHE_LIMITS = {
  VIDEO_CACHE_TTL: 10 * 60 * 1000,
  SEARCH_CACHE_TTL: 24 * 3600 * 1000 // 24 hours
}

const MAX_ENTRIES = 200

type Entry<T> = { value: T; expiresAt: number }

const searches = new Map<string, Entry<Song[]>>()
const videos = new Map<string, Entry<VideoCacheResult>>()

// YouTube resets daily API quota at midnight Pacific Time — do not change this timezone
function getQuotaDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date())
}

let quotaExhaustedDate: string | null = null

export function markQuotaExhausted(): void {
  quotaExhaustedDate = getQuotaDate()
}

export function isQuotaExhausted(): boolean {
  const today = getQuotaDate()
  if (quotaExhaustedDate !== today) {
    quotaExhaustedDate = null
    return false
  }
  return true
}

function read<T>(map: Map<string, Entry<T>>, key: string): T | undefined {
  const entry = map.get(key)
  if (!entry) return undefined
  if (entry.expiresAt <= Date.now()) {
    map.delete(key)
    return undefined
  }
  return entry.value
}

function write<T>(map: Map<string, Entry<T>>, key: string, value: T, ttl: number): void {
  map.delete(key) // re-inserted, so the oldest entry is always the first one
  map.set(key, { value, expiresAt: Date.now() + ttl })
  if (map.size > MAX_ENTRIES) map.delete(map.keys().next().value as string)
}

export function getSearchCache(key: string): Song[] | undefined {
  return read(searches, key)
}

export function setSearchCache(key: string, songs: Song[]): void {
  write(searches, key, songs, CACHE_LIMITS.SEARCH_CACHE_TTL)
}

export type VideoCacheResult = { song: Song | null; reason: FilterFailureReason | null }

export function getVideoCache(key: string): VideoCacheResult | undefined {
  return read(videos, key)
}

export function setVideoCache(key: string, result: VideoCacheResult): void {
  write(videos, key, result, CACHE_LIMITS.VIDEO_CACHE_TTL)
}
