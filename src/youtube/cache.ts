import { CACHE_FILE, createFileStore } from '../persist.js'
import { CacheFile, Song } from '../types.js'

const store = createFileStore<CacheFile>(CACHE_FILE)
const cache = store.load({
  searches: {},
  videos: {},
  quota: { date: getQuotaDate(), searches: 0 }
})

export const CACHE_LIMITS = {
  VIDEO_CACHE_TTL: 10 * 60 * 1000,
  SEARCH_CACHE_TTL: 3600 * 1000, // 1 hour
  MAX_DAILY_SEARCHES: 80 // Maximum number of searches allowed per day
}

const SWEEP_INTERVAL = 60 * 60 * 1000

function getQuotaDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date())
}

function saveCache(): void {
  store.scheduleSave(
    () => cache,
    (error) => console.error('[CACHE] Failed to save cache:', error instanceof Error ? error.message : error)
  )
}

function sweepExpired(): void {
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

setInterval(sweepExpired, SWEEP_INTERVAL).unref()

function resetQuotaIfNeeded(): void {
  const today = getQuotaDate()

  if (cache.quota.date === today) {
    return
  }

  cache.quota = { date: today, searches: 0 }
  saveCache()
}

export function getSearchCache(query: string, filtersVersion: string): Song[] | null {
  const entry = cache.searches[query]

  if (!entry || entry.expiresAt <= Date.now() || entry.filtersVersion !== filtersVersion) {
    return null
  }

  return entry.results
}

export function setSearchCache(query: string, results: Song[], filtersVersion: string): void {
  cache.searches[query] = {
    results,
    expiresAt: Date.now() + CACHE_LIMITS.SEARCH_CACHE_TTL,
    filtersVersion
  }

  saveCache()
}

export function getVideoCache(videoId: string, filtersVersion: string): Song | null | undefined {
  const entry = cache.videos[videoId]

  if (!entry || entry.expiresAt <= Date.now() || entry.filtersVersion !== filtersVersion) {
    return undefined
  }

  return entry.song
}

export function setVideoCache(videoId: string, song: Song | null, filtersVersion: string): void {
  cache.videos[videoId] = {
    song,
    expiresAt: Date.now() + CACHE_LIMITS.VIDEO_CACHE_TTL,
    filtersVersion
  }

  saveCache()
}

export function canSearch(): boolean {
  resetQuotaIfNeeded()
  return cache.quota.searches < CACHE_LIMITS.MAX_DAILY_SEARCHES
}

export function consumeSearchQuota(): void {
  resetQuotaIfNeeded()
  cache.quota.searches += 1
  saveCache()
  console.log(`[QUOTA] Search usage: ${cache.quota.searches}/${CACHE_LIMITS.MAX_DAILY_SEARCHES}`)
}
