import { cachePath, createFileStore } from '../persist.js'
import { createLogger, describeError } from '../logger.js'
import { CacheFile, Song, FilterFailureReason } from '../types.js'

const log = createLogger('CACHE')
const store = createFileStore<CacheFile>(() => cachePath('youtube-cache.json'))

export const CACHE_LIMITS = {
  VIDEO_CACHE_TTL: 10 * 60 * 1000,
  SEARCH_CACHE_TTL: 3600 * 1000, // 1 hour
  // Each search call costs 100 quota units of the default 10,000/day project quota;
  // 90 searches/day (9,000 units) leaves headroom for other endpoints (1 unit each)
  MAX_DAILY_SEARCHES: 90
}

const SWEEP_INTERVAL = 60 * 60 * 1000

// YouTube resets daily API quota at midnight Pacific Time — do not change this timezone
function getQuotaDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date())
}

// Loaded from disk, and the hourly sweep started, on first use - not when the module is imported
let loadedCache: CacheFile | null = null

function getCache(): CacheFile {
  if (!loadedCache) {
    loadedCache = store.load({
      searches: {},
      videos: {},
      quota: { date: getQuotaDate(), searches: 0 }
    })
    setInterval(sweepExpired, SWEEP_INTERVAL).unref()
  }

  return loadedCache
}

function saveCache(): void {
  store.scheduleSave(
    () => getCache(),
    (error) => log.error(`Failed to save cache: ${describeError(error)}`)
  )
}

function sweepExpired(): void {
  const cache = getCache()
  const now = Date.now()
  let hasChanges = false

  for (const key in cache.searches) {
    if (cache.searches[key].expiresAt <= now) {
      delete cache.searches[key]
      hasChanges = true
    }
  }

  for (const key in cache.videos) {
    if (cache.videos[key].expiresAt <= now) {
      delete cache.videos[key]
      hasChanges = true
    }
  }

  if (hasChanges) {
    saveCache()
  }
}

function resetQuotaIfNeeded(): void {
  const cache = getCache()
  const today = getQuotaDate()

  if (cache.quota.date === today) {
    return
  }

  cache.quota = { date: today, searches: 0 }
  saveCache()
}

export function getSearchCache(query: string, filtersVersion: string): Song[] | null {
  const entry = getCache().searches[query]

  if (!entry || entry.expiresAt <= Date.now() || entry.filtersVersion !== filtersVersion) {
    return null
  }

  return entry.results
}

export function setSearchCache(query: string, results: Song[], filtersVersion: string): void {
  getCache().searches[query] = {
    results,
    expiresAt: Date.now() + CACHE_LIMITS.SEARCH_CACHE_TTL,
    filtersVersion
  }

  saveCache()
}

export type VideoCacheResult = { song: Song | null; reason: FilterFailureReason | null }

export function getVideoCache(videoId: string, filtersVersion: string): VideoCacheResult | undefined {
  const entry = getCache().videos[videoId]

  if (!entry || entry.expiresAt <= Date.now() || entry.filtersVersion !== filtersVersion) {
    return undefined
  }

  return { song: entry.song, reason: entry.reason ?? null }
}

export function setVideoCache(videoId: string, song: Song | null, filtersVersion: string, reason: FilterFailureReason | null = null): void {
  getCache().videos[videoId] = {
    song,
    reason,
    expiresAt: Date.now() + CACHE_LIMITS.VIDEO_CACHE_TTL,
    filtersVersion
  }

  saveCache()
}

export function canSearch(): boolean {
  resetQuotaIfNeeded()
  return getCache().quota.searches < CACHE_LIMITS.MAX_DAILY_SEARCHES
}

export function consumeSearchQuota(): void {
  resetQuotaIfNeeded()
  const { quota } = getCache()
  quota.searches += 1
  saveCache()
  log.info(`Search quota usage: ${quota.searches}/${CACHE_LIMITS.MAX_DAILY_SEARCHES}`)
}
