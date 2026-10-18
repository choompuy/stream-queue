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
  PlaylistFetchResult,
  fetchVideos
} from './client.js'
import { normalize } from './utils.js'
import { getSearchCache, setSearchCache, getVideoCache, setVideoCache } from './cache.js'
import { VideoItem, SearchItem, PlaylistItem } from './types.js'
import { getConfig } from '../config.js'
import { createLogger, describeError } from '../logger.js'

const pendingSearches = new Map<string, Promise<VideoItem[]>>()
const pendingVideos = new Map<string, Promise<VideoItem | null>>()
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

function searchCacheKey(normalizedQuery: string): string {
  return `${getConfig().contentMode}|${normalizedQuery}`
}

export async function getVideoById(videoId: string, bypassFilters = false): Promise<Song | null> {
  // the raw video is cached without the filters: they are applied on every read, so their change keeps the entry valid
  const cached = getVideoCache(videoId)
  const video = cached !== undefined ? cached : await dedupInFlight(pendingVideos, videoId, () => fetchVideoById(videoId))

  if (!video) return null

  const song = videoToSong(video)
  if (bypassFilters) return song

  const reason = getFilterFailureReason(song, video)
  if (reason) throwFilterError(reason, getConfig())

  return song
}

async function fetchVideoById(videoId: string): Promise<VideoItem | null> {
  const [video] = await withYouTubeErrorHandling('YouTube API', () => fetchVideos([videoId]))

  setVideoCache(videoId, video ?? null)
  return video ?? null
}

export async function searchSongs(query: string, bypassFilters = false): Promise<Song[]> {
  // normalize() keeps letters and digits only, so a group named "!!!" would search nothing: when
  // normalization empties the query, the trimmed lowercase text is the key, and the API still gets it as typed
  const normalizedQuery = normalize(query) || query.trim().toLowerCase()
  if (!normalizedQuery) return []

  const cacheKey = searchCacheKey(normalizedQuery)
  const cached = getSearchCache(cacheKey)
  if (cached !== undefined) return mapValidSongs(cached, bypassFilters)

  const trimmedQuery = query.trim()
  const videos = await dedupInFlight(pendingSearches, cacheKey, () => performSearch(trimmedQuery, cacheKey))
  return mapValidSongs(videos, bypassFilters)
}

function mapValidSongs(videos: VideoItem[], bypassFilters = false): Song[] {
  return videos
    .map((video) => ({ video, song: videoToSong(video) }))
    .filter(({ video, song }) => bypassFilters || isValidSong(song, video))
    .map(({ song }) => song)
}

async function performSearch(query: string, cacheKey: string): Promise<VideoItem[]> {
  const search = await youtube<{ items: SearchItem[] }>(
    'search',
    {
      part: 'snippet',
      q: query,
      type: 'video',
      ...(getConfig().contentMode === 'music' ? { videoCategoryId: MUSIC_CATEGORY_ID } : {}),
      videoEmbeddable: 'true',
      videoSyndicated: 'true',
      maxResults: '20',
      order: 'relevance',
      safeSearch: 'moderate'
    },
    { attempts: 1 }
  )

  const ids = (search.items ?? []).map((item) => item.id?.videoId).filter((id): id is string => Boolean(id))

  if (!ids.length) {
    setSearchCache(cacheKey, [])
    return []
  }

  const videos = await fetchVideos(ids)
  setSearchCache(cacheKey, videos)

  return videos
}

/**
 * Selects a song from a search result list. Returns the first song that passes the isAvailable check.
 * If no song passes the check, returns the first song in the list (even if blocked or duplicate) so that
 * addSong can throw a meaningful error. Returns null if the list is empty.
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
