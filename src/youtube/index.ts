import { Song } from '../types.js'
import { youtube, fetchVideos } from './client.js'
import { checkFilters, MUSIC_CATEGORY_ID } from './filters.js'
import { videoToSong, fetchPlaylistMeta, type PlaylistFetchResult } from './mapper.js'
import { normalize } from './utils.js'
import { getSearchCache, setSearchCache, getVideoCache, setVideoCache } from './cache.js'
import { VideoItem, SearchItem, PlaylistItem } from './types.js'
import { getConfig } from '../config.js'
import { createLogger, describeError } from '../logger.js'

const pendingSearches = new Map<string, Promise<VideoItem[]>>()
const pendingVideos = new Map<string, Promise<VideoItem | null>>()
const pendingPlaylists = new Map<string, Promise<PlaylistFetchResult>>()
const PLAYLIST_PAGE_SIZE = 50
const MAX_PLAYLIST_PAGES = 5

const log = createLogger('YOUTUBE')

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

  const failure = checkFilters(song, video, getConfig())
  if (failure) throw failure

  return song
}

async function fetchVideoById(videoId: string): Promise<VideoItem | null> {
  // youtube() turns every failure into an AppError already, and the flow that owns the request
  // (a song request, a playlist load) logs it at its own level - nothing to re-wrap here
  const [video] = await fetchVideos([videoId])

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
  if (cached !== undefined) return mapValidSongs(cached, bypassFilters ? 'bypass' : 'viewer')

  const trimmedQuery = query.trim()
  const videos = await dedupInFlight(pendingSearches, cacheKey, () => performSearch(trimmedQuery, cacheKey))
  return mapValidSongs(videos, bypassFilters ? 'bypass' : 'viewer')
}

// which rules a list of videos is held against: the viewer rules, the guard rules alone (the streamer's own
// playlist answers to those: what the viewer rules would trim away is the streamer's own choice), or none at all
function mapValidSongs(videos: VideoItem[], scope: 'viewer' | 'guard' | 'bypass' = 'viewer'): Song[] {
  return videos
    .map((video) => ({ video, song: videoToSong(video) }))
    .filter(({ video, song }) => scope === 'bypass' || checkFilters(song, video, getConfig(), scope === 'guard') === null)
    .map(({ song }) => song)
}

async function performSearch(query: string, cacheKey: string): Promise<VideoItem[]> {
  const search = await youtube<{ items: SearchItem[] }>(
    'search',
    {
      part: 'snippet',
      // only the ids are read: the titles and the rest come with the videos.list answer that follows
      fields: 'items/id/videoId',
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

export async function fetchPlaylistSongs(playlistId: string): Promise<PlaylistFetchResult> {
  if (!playlistId) {
    return { songs: [], truncated: false, itemCount: null }
  }

  return dedupInFlight(pendingPlaylists, playlistId, () => performPlaylistFetch(playlistId))
}

async function performPlaylistFetch(playlistId: string): Promise<PlaylistFetchResult> {
  const ids = new Set<string>()
  let pageToken: string | undefined
  let truncated = false

  for (let page = 1; ; page++) {
    const playlist = await youtube<{ items?: PlaylistItem[]; nextPageToken?: string }>('playlistItems', {
      part: 'snippet',
      fields: 'nextPageToken,items/snippet/resourceId/videoId',
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

  // the declared size only decorates the panel's "N of M": asked for alongside the videos, best-effort,
  // so an endpoint with nothing to say takes the number away, never the loaded tracks
  const meta = fetchPlaylistMeta(playlistId).catch((error) => {
    log.warn(`Playlist: the declared size is unavailable: ${describeError(error)}`)
    return null
  })
  const songs = mapValidSongs(await fetchVideos([...ids]), 'guard')
  log.info(`Playlist: ${songs.length} tracks loaded`)
  return { songs, truncated, itemCount: (await meta)?.itemCount ?? null }
}
