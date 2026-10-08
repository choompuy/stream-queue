import { dataPath, createFileStore } from '../persist.js'
import { createLogger, describeError } from '../logger.js'
import { Song, FilterFailureReason } from '../types.js'

const log = createLogger('CACHE')

export const CACHE_LIMITS = {
  VIDEO_CACHE_TTL: 10 * 60 * 1000,
  SEARCH_CACHE_TTL: 3600 * 1000, // 1 hour
  // Each search call costs 100 quota units of the default 10,000/day project quota;
  // 90 searches/day (9,000 units) leaves headroom for other endpoints (1 unit each)
  MAX_DAILY_SEARCHES: 90
}

const MAX_ENTRIES = 200

type Entry<T> = { value: T; expiresAt: number }

const searches = new Map<string, Entry<Song[]>>()
const videos = new Map<string, Entry<VideoCacheResult>>()

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

// quota: the only thing that must survive a restart (and a cache cleanup)
type Quota = { date: string; searches: number }
const quotaStore = createFileStore<Quota>(() => dataPath('youtube-quota.json'))
let quota: Quota | null = null

// YouTube resets daily API quota at midnight Pacific Time — do not change this timezone
function getQuotaDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date())
}

function currentQuota(): Quota {
  const today = getQuotaDate()
  quota ??= quotaStore.load({ date: today, searches: 0 })
  if (quota.date !== today) quota = { date: today, searches: 0 }
  return quota
}

const saveQuota = () => quotaStore.scheduleSave(() => currentQuota(), (error) => log.error(`Failed to save quota: ${describeError(error)}`))

export function reserveSearchQuota(): boolean {
  const current = currentQuota()
  if (current.searches >= CACHE_LIMITS.MAX_DAILY_SEARCHES) return false
  current.searches++
  saveQuota()
  return true
}

export function releaseSearchQuota(): void {
  const current = currentQuota()
  if (current.searches > 0) current.searches--
  saveQuota()
}

export const getSearchesToday = (): number => currentQuota().searches
