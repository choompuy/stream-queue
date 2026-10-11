import { Song, AppError } from '../types.js'
import {
  youtube,
  videoToSong,
  isValidSong,
  getFilterFailureReason,
  throwFilterError,
  fetchPlaylistMeta,
  PlaylistMeta,
  MUSIC_CATEGORY_ID,
  RequestNotSentError,
  PlaylistFetchResult,
  fetchVideos
} from './client.js'
import { normalize } from './utils.js'
import { getSearchCache, setSearchCache, getVideoCache, setVideoCache, reserveSearchQuota, releaseSearchQuota, CACHE_LIMITS } from './cache.js'
import { VideoItem, SearchItem, PlaylistItem } from './types.js'
import { getConfig } from '../config.js'
import { createLogger, describeError } from '../logger.js'

const pendingSearches = new Map<string, Promise<Song[]>>()
const pendingVideos = new Map<string, Promise<Song | null>>()
const pendingPlaylists = new Map<string, Promise<PlaylistFetchResult>>()
const PLAYLIST_PAGE_SIZE = 50
const MAX_PLAYLIST_PAGES = 3

const log = createLogger('YOUTUBE')

async function withYouTubeErrorHandling<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    log.error(`${label}: ${describeError(error)}`)
    if (error instanceof AppError) throw error
    throw new AppError('YOUTUBE_ERROR', `${label} failed`)
  }
}

function dedupInFlight<T>(pending: Map<string, Promise<T>>, key: string, run: () => Promise<T>): Promise<T> {
  const existing = pending.get(key)
  if (existing) return existing

  const request = run()
  pending.set(key, request)
  return request.finally(() => pending.delete(key))
}

function filtersVersion(): string {
  const c = getConfig()
  return `${c.minViews}:${c.minDurationSeconds}:${c.maxDurationSeconds}:${c.regionCode}:${c.allowShorts}:${c.allowLiveStreams}:${c.contentMode}`
}

export async function getVideoById(videoId: string, bypassFilters = false): Promise<Song | null> {
  const cacheKey = bypassFilters ? `raw:${videoId}` : `${filtersVersion()}|${videoId}`
  const cached = bypassFilters ? undefined : getVideoCache(cacheKey)

  if (cached !== undefined) {
    if (cached.song === null && cached.reason) {
      throwFilterError(cached.reason, getConfig())
    }
    return cached.song
  }

  return dedupInFlight(pendingVideos, cacheKey, () => fetchVideoById(videoId, bypassFilters))
}

async function fetchVideoById(videoId: string, bypassFilters: boolean): Promise<Song | null> {
  const [video] = await withYouTubeErrorHandling('YouTube API', () => fetchVideos([videoId]))

  if (!video) {
    if (!bypassFilters) setVideoCache(`${filtersVersion()}|${videoId}`, { song: null, reason: null })
    return null
  }

  const song = videoToSong(video)

  if (!bypassFilters) {
    const reason = getFilterFailureReason(song, video)
    if (reason) {
      setVideoCache(`${filtersVersion()}|${videoId}`, { song: null, reason })
      throwFilterError(reason, getConfig())
    }
  }

  if (!bypassFilters) setVideoCache(`${filtersVersion()}|${videoId}`, { song, reason: null })

  return song
}

export async function searchSongs(query: string, bypassFilters = false): Promise<Song[]> {
  const normalizedQuery = normalize(query)
  if (!normalizedQuery) return []

  const cacheKey = bypassFilters ? `raw:${normalizedQuery}` : `${filtersVersion()}|${normalizedQuery}`
  const cached = bypassFilters ? undefined : getSearchCache(cacheKey)
  if (cached !== undefined) return cached

  return dedupInFlight(pendingSearches, cacheKey, () => performSearch(normalizedQuery, bypassFilters))
}

function mapValidSongs(videos: VideoItem[], bypassFilters = false): Song[] {
  return videos
    .map((video) => ({ video, song: videoToSong(video) }))
    .filter(({ video, song }) => bypassFilters || isValidSong(song, video))
    .map(({ song }) => song)
}

async function performSearch(query: string, bypassFilters: boolean): Promise<Song[]> {
  // after the cache and the in-flight check, so only a search that really goes out costs quota
  if (!reserveSearchQuota()) {
    log.warn(`Daily search limit reached: ${CACHE_LIMITS.MAX_DAILY_SEARCHES}`)
    throw new AppError('YOUTUBE_QUOTA', 'daily YouTube search quota exceeded, use a direct link instead')
  }

  let search: { items: SearchItem[] }
  try {
    search = await youtube<{ items: SearchItem[] }>(
      'search',
      {
        part: 'snippet',
        q: query,
        type: 'video',
        // 'any' searches every category; clips filed outside Music are reachable by link only in 'music' mode
        ...(getConfig().contentMode === 'music' ? { videoCategoryId: MUSIC_CATEGORY_ID } : {}),
        videoEmbeddable: 'true',
        videoSyndicated: 'true',
        maxResults: '20',
        order: 'relevance',
        safeSearch: 'moderate'
      },
      { attempts: 1 }
    )
  } catch (error) {
    // only a search that never left is given back: a timeout or an error answer may well have been charged, and counting
    // one search too many is harmless while counting one too few could run the real daily quota out
    if (error instanceof RequestNotSentError) releaseSearchQuota()
    throw error
  }

  const ids = (search.items ?? []).map((item) => item.id?.videoId).filter((id): id is string => Boolean(id))
  const cacheKey = bypassFilters ? `raw:${query}` : `${filtersVersion()}|${query}`

  if (!ids.length) {
    if (!bypassFilters) setSearchCache(cacheKey, [])
    return []
  }

  const videos = await fetchVideos(ids)
  const songs = mapValidSongs(videos, bypassFilters)

  if (!bypassFilters) setSearchCache(cacheKey, songs)

  return songs
}

/**
 * The best match of a result list from searchSongs(). The list is ordered by YouTube's relevance rank, which is
 * only known during the search. The first available song is returned.
 */
export function selectBestSong(songs: Song[], isAvailable: (song: Song) => boolean = () => true): Song | null {
  const selected = songs.find(isAvailable) ?? songs[0]
  if (!selected) return null

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

async function performPlaylistFetch(playlistId: string): Promise<PlaylistFetchResult> {
  return withYouTubeErrorHandling('Playlist fetch', async () => {
    const ids = new Set<string>()
    let pageToken: string | undefined
    let truncated = false

    for (let page = 1; ; page++) {
      const playlist = await youtube<{ items?: PlaylistItem[]; nextPageToken?: string }>('playlistItems', {
        part: 'snippet',
        playlistId,
        maxResults: String(PLAYLIST_PAGE_SIZE),
        ...(pageToken ? { pageToken } : {})
      })

      for (const item of playlist.items ?? []) {
        const id = item.snippet?.resourceId?.videoId
        if (id) ids.add(id)
      }

      pageToken = playlist.nextPageToken
      if (!pageToken) break

      if (page >= MAX_PLAYLIST_PAGES) {
        log.warn(`Playlist: maximum page limit reached (${MAX_PLAYLIST_PAGES}), the rest is not loaded`)
        truncated = true
        break
      }
    }

    const songs = mapValidSongs(await fetchVideos([...ids]))
    log.log(`Playlist: ${songs.length} tracks loaded`)
    return { songs, truncated }
  })
}
