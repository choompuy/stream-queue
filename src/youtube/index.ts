import { Song, AppError } from '../types.js'
import {
  youtube,
  videoToSong,
  isValidSong,
  getFilterFailureReason,
  throwFilterError,
  fetchPlaylistMeta,
  PlaylistMeta,
  VIDEO_DETAILS_PART,
  PlaylistFetchResult
} from './client.js'
import { normalize, combinedScore, formatViews } from './scoring.js'
import { getSearchCache, setSearchCache, getVideoCache, setVideoCache, canSearch, consumeSearchQuota, CACHE_LIMITS } from './cache.js'
import { VideoItem, SearchItem, PlaylistItem } from './types.js'
import { getConfig } from '../config.js'

const pendingSearches = new Map<string, Promise<Song[]>>()
const pendingVideos = new Map<string, Promise<Song | null>>()
const pendingPlaylists = new Map<string, Promise<PlaylistFetchResult>>()
const YOUTUBE_ID_BATCH_SIZE = 50
const PLAYLIST_PAGE_SIZE = 50
const MAX_PLAYLIST_PAGES = 3

const DEBUG = process.env.YOUTUBE_DEBUG === 'true'
function debugLog(message: string): void {
  if (DEBUG) console.log(message)
}

async function withYouTubeErrorHandling<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    console.error(`[ERROR] ${label}:`, error instanceof Error ? error.message : error)
    if (error instanceof AppError) throw error
    throw new AppError('YOUTUBE_ERROR', `${label} failed`)
  }
}

function dedupInFlight<T>(pending: Map<string, Promise<T>>, key: string, run: () => Promise<T>): Promise<T> {
  const existing = pending.get(key)

  if (existing) {
    return existing
  }

  const request = run()
  pending.set(key, request)
  return request.finally(() => pending.delete(key))
}

function filtersVersion(): string {
  const c = getConfig()
  return `${c.minViews}:${c.minDurationSeconds}:${c.maxDurationSeconds}:${c.regionCode}:${c.allowShorts}:${c.allowLiveStreams}`
}

export async function getVideoById(videoId: string, bypassFilters = false): Promise<Song | null> {
  debugLog(`[VIDEO] Fetching video by ID: ${videoId}`)
  const cached = bypassFilters ? undefined : getVideoCache(videoId, filtersVersion())

  if (cached !== undefined) {
    debugLog(`[CACHE] Video ${videoId}`)
    if (cached.song === null && cached.reason) {
      throwFilterError(cached.reason, getConfig())
    }
    return cached.song
  }

  return dedupInFlight(pendingVideos, `${bypassFilters ? 'raw:' : ''}${videoId}`, () => fetchVideoById(videoId, bypassFilters))
}

async function fetchVideoById(videoId: string, bypassFilters: boolean): Promise<Song | null> {
  return withYouTubeErrorHandling('YouTube API', async () => {
    const details = await youtube<{ items: VideoItem[] }>('videos', {
      part: VIDEO_DETAILS_PART,
      id: videoId
    })

    const video = details.items?.[0]

    if (!video) {
      debugLog(`[VIDEO] Video not found: ${videoId}`)
      if (!bypassFilters) setVideoCache(videoId, null, filtersVersion())
      return null
    }

    const song = videoToSong(video)

    if (!bypassFilters) {
      const reason = getFilterFailureReason(song, video)
      if (reason) {
        debugLog(`[VIDEO] Video rejected (${reason}): "${song.title}"`)
        setVideoCache(videoId, null, filtersVersion(), reason)
        throwFilterError(reason, getConfig())
      }
    }

    debugLog(`[VIDEO] Valid: "${song.title}" - ${formatViews(song.views)} views`)
    if (!bypassFilters) setVideoCache(videoId, song, filtersVersion())

    return song
  })
}

export async function searchSongs(query: string, bypassFilters = false): Promise<Song[]> {
  const normalizedQuery = normalize(query)

  debugLog(`[SEARCH] Query: "${normalizedQuery}"`)

  if (!normalizedQuery) {
    return []
  }

  const cacheKey = bypassFilters ? `raw:${normalizedQuery}` : normalizedQuery
  const cached = bypassFilters ? null : getSearchCache(normalizedQuery, filtersVersion())

  if (cached !== null) {
    debugLog(`[CACHE] Search: "${normalizedQuery}" - ${cached.length} results`)
    return cached
  }

  if (!canSearch()) {
    console.warn(`[QUOTA] Daily search limit reached: ${CACHE_LIMITS.MAX_DAILY_SEARCHES}`)
    throw new AppError('YOUTUBE_QUOTA', 'daily YouTube search quota exceeded, use a direct link instead')
  }

  return dedupInFlight(pendingSearches, cacheKey, () => performSearch(normalizedQuery, bypassFilters))
}

function mapValidSongs(videos: VideoItem[], bypassFilters = false): Song[] {
  return videos
    .map((video) => ({ video, song: videoToSong(video) }))
    .filter(({ video, song }) => bypassFilters || isValidSong(song, video))
    .map(({ song }) => song)
}

async function performSearch(query: string, bypassFilters: boolean): Promise<Song[]> {
  return withYouTubeErrorHandling('YouTube search', async () => {
    const search = await youtube<{ items: SearchItem[] }>('search', {
      part: 'snippet',
      q: query,
      type: 'video',
      videoCategoryId: '10',
      videoEmbeddable: 'true',
      videoSyndicated: 'true',
      maxResults: '20',
      order: 'relevance',
      safeSearch: 'moderate'
    })
    consumeSearchQuota()

    const ids = (search.items ?? []).map((item) => item.id?.videoId).filter((id): id is string => Boolean(id))
    const relevanceRank = new Map(ids.map((id, i) => [id, i]))
    debugLog(`[SEARCH] Found ${ids.length} candidates`)

    if (!ids.length) {
      if (!bypassFilters) setSearchCache(query, [], filtersVersion())
      return []
    }

    const details = await youtube<{ items: VideoItem[] }>('videos', {
      part: VIDEO_DETAILS_PART,
      id: ids.join(',')
    })

    const songs = mapValidSongs(details.items ?? [], bypassFilters)

    debugLog(`[FILTER] ${songs.length} suitable results`)
    songs.sort(
      (a, b) => combinedScore(b, query, relevanceRank.get(b.videoId), ids.length) - combinedScore(a, query, relevanceRank.get(a.videoId), ids.length)
    )
    if (!bypassFilters) {
      setSearchCache(query, songs, filtersVersion())
      debugLog(`[CACHE] Saved "${query}" - ${songs.length} results`)
    }
    return songs
  })
}

export function selectBestSong(songs: Song[], query: string): Song | null {
  if (!songs.length) {
    return null
  }

  const ranked = songs.map((song) => ({ song, score: combinedScore(song, query) })).sort((a, b) => b.score - a.score)
  const selected = ranked[0].song
  debugLog(`[SELECT] "${selected.title}" - ${formatViews(selected.views)} views`)
  return selected
}

export { fetchPlaylistMeta }
export type { PlaylistMeta, PlaylistFetchResult }

export async function fetchPlaylistSongs(playlistId: string): Promise<PlaylistFetchResult> {
  if (!playlistId) {
    return { songs: [], truncated: false }
  }

  return dedupInFlight(pendingPlaylists, playlistId, () => performPlaylistFetch(playlistId))
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size))
  }
  return result
}

async function performPlaylistFetch(playlistId: string): Promise<PlaylistFetchResult> {
  return withYouTubeErrorHandling('Playlist fetch', async () => {
    debugLog(`[PLAYLIST] Fetching playlist: ${playlistId}`)

    const videoIds: string[] = []
    const seenVideoIds = new Set<string>()
    const seenPageTokens = new Set<string>()

    let pageToken: string | undefined
    let page = 0
    let truncated = false

    do {
      page++

      if (page >= MAX_PLAYLIST_PAGES) {
        console.warn(`[PLAYLIST] Maximum page limit reached (${MAX_PLAYLIST_PAGES}), stopping`)
        truncated = true
        break
      }

      if (pageToken) {
        if (seenPageTokens.has(pageToken)) {
          console.warn(`[PLAYLIST] Repeated page token detected, stopping pagination`)
          break
        }
        seenPageTokens.add(pageToken)
      }

      debugLog(`[PLAYLIST] Loading page ${page}${pageToken ? `, token=${pageToken.slice(0, 10)}...` : ''}`)
      const playlist = await youtube<{ items: PlaylistItem[]; nextPageToken?: string }>('playlistItems', {
        part: 'snippet',
        playlistId,
        maxResults: String(PLAYLIST_PAGE_SIZE),
        ...(pageToken ? { pageToken } : {})
      })

      const items = playlist.items ?? []
      let newItems = 0
      let duplicateItems = 0

      for (const item of items) {
        const id = item.snippet?.resourceId?.videoId

        if (!id) continue
        if (seenVideoIds.has(id)) {
          duplicateItems++
          continue
        }

        seenVideoIds.add(id)
        videoIds.push(id)
        newItems++
      }

      debugLog(`[PLAYLIST] Page ${page}: ${items.length} items, ${newItems} new, ${duplicateItems} duplicates, total unique IDs: ${videoIds.length}`)

      const nextPageToken = playlist.nextPageToken
      if (nextPageToken && seenPageTokens.has(nextPageToken)) {
        console.warn(`[PLAYLIST] YouTube returned a repeated page token, stopping pagination`)
        break
      }

      pageToken = nextPageToken
    } while (pageToken)

    if (!videoIds.length) {
      debugLog(`[PLAYLIST] No videos in playlist: ${playlistId}`)
      return { songs: [], truncated: false }
    }

    debugLog(`[PLAYLIST] Collected ${videoIds.length} unique video IDs, loading video details`)
    const allVideoItems: VideoItem[] = []
    const batches = chunk(videoIds, YOUTUBE_ID_BATCH_SIZE)

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]
      debugLog(`[PLAYLIST] Loading video batch ${i + 1}/${batches.length} (${batch.length} videos)`)
      const details = await youtube<{ items: VideoItem[] }>('videos', {
        part: VIDEO_DETAILS_PART,
        id: batch.join(',')
      })
      allVideoItems.push(...(details.items ?? []))
      debugLog(`[PLAYLIST] Video batch ${i + 1}/${batches.length} complete, total details: ${allVideoItems.length}`)
    }

    const songs = mapValidSongs(allVideoItems)
    debugLog(`[PLAYLIST] Fetched ${songs.length} valid unique songs from playlist: ${playlistId}`)
    return { songs, truncated }
  })
}
