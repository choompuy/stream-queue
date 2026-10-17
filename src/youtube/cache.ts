import { createLogger } from '../logger.js'
import type { VideoItem } from './types.js'

export const CACHE_LIMITS = {
  VIDEO_CACHE_TTL: 10 * 60 * 1000,
  SEARCH_CACHE_TTL: 24 * 3600 * 1000 // 24 hours
}

const MAX_ENTRIES = 200

type Entry<T> = { value: T; expiresAt: number }

// Both caches hold the raw answers from YouTube, not the songs the filters picked out of them: what a change
// of the filters invalidates is decided when the data is read, so it does not throw away paid-for requests
const searches = new Map<string, Entry<VideoItem[]>>()
const videos = new Map<string, Entry<VideoItem | null>>()

const log = createLogger('YOUTUBE QUOTA')

// YouTube resets daily API quota at midnight Pacific Time — do not change this timezone.
// One formatter for the whole run: building it per call is measurable work on every request while the quota is exhausted
const quotaDayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
})

function getQuotaDate(): string {
  return quotaDayFormat.format(new Date())
}

let quotaExhaustedDate: string | null = null

export function markQuotaExhausted(): void {
  const today = getQuotaDate()
  if (quotaExhaustedDate === today) return

  quotaExhaustedDate = today
  // the one line about it, at the moment it becomes true: every request the flag blocks afterwards stays silent
  log.warn('YouTube quota exhausted: requests are paused until midnight Pacific Time')
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

export function getSearchCache(key: string): VideoItem[] | undefined {
  return read(searches, key)
}

export function setSearchCache(key: string, videos: VideoItem[]): void {
  write(searches, key, videos, CACHE_LIMITS.SEARCH_CACHE_TTL)
}

export function getVideoCache(key: string): VideoItem | null | undefined {
  return read(videos, key)
}

export function setVideoCache(key: string, video: VideoItem | null): void {
  write(videos, key, video, CACHE_LIMITS.VIDEO_CACHE_TTL)
}
