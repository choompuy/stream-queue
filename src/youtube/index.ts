import { Song, AppError } from '../types.js'
import { youtube, videoToSong, isValidSong, getFilterFailureReason, throwFilterError, fetchPlaylistMeta, PlaylistMeta } from './client.js'
import { normalize, combinedScore, formatViews } from './scoring.js'
import { getSearchCache, setSearchCache, getVideoCache, setVideoCache, canSearch, consumeSearchQuota, CACHE_LIMITS } from './cache.js'
import { VideoItem, SearchItem, PlaylistItem } from './types.js'
import { getConfig } from '../config.js'

const pendingSearches = new Map<string, Promise<Song[]>>()
const pendingVideos = new Map<string, Promise<Song | null>>()
const pendingPlaylists = new Map<string, Promise<Song[]>>()
const YOUTUBE_ID_BATCH_SIZE = 50
const PLAYLIST_PAGE_SIZE = 50
const MAX_PLAYLIST_PAGES = 3

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
  console.log(`[VIDEO] Fetching video by ID: ${videoId}`)
  const cached = bypassFilters ? undefined : getVideoCache(videoId, filtersVersion())

  if (cached !== undefined) {
    console.log(`[CACHE] Video ${videoId}`)
    if (cached.song === null && cached.reason) {
      throwFilterError(cached.reason, getConfig())
    }
    return cached.song
  }

  return dedupInFlight(pendingVideos, `${bypassFilters ? 'raw:' : ''}${videoId}`, () => fetchVideoById(videoId, bypassFilters))
}

async function fetchVideoById(videoId: string, bypassFilters: boolean): Promise<Song | null> {
  try {
    const details = await youtube<{ items: VideoItem[] }>('videos', {
      part: 'snippet,contentDetails,statistics,status',
      id: videoId
    })

    const video = details.items?.[0]

    if (!video) {
      console.log(`[VIDEO] Video not found: ${videoId}`)
      if (!bypassFilters) setVideoCache(videoId, null, filtersVersion())
      return null
    }

    const song = videoToSong(video)

    if (!bypassFilters) {
      const reason = getFilterFailureReason(song, video)
      if (reason) {
        console.log(`[VIDEO] Video rejected (${reason}): "${song.title}"`)
        setVideoCache(videoId, null, filtersVersion(), reason)
        throwFilterError(reason, getConfig())
      }
    }

    console.log(`[VIDEO] Valid: "${song.title}" - ${formatViews(song.views)} views`)
    if (!bypassFilters) setVideoCache(videoId, song, filtersVersion())

    return song
  } catch (error) {
    console.error('[ERROR] YouTube API:', error instanceof Error ? error.message : error)

    if (error instanceof AppError) throw error

    throw new AppError('YOUTUBE_ERROR', 'failed to fetch video from YouTube')
  }
}

export async function searchSongs(query: string, bypassFilters = false): Promise<Song[]> {
  const normalizedQuery = normalize(query)

  console.log(`[SEARCH] Query: "${normalizedQuery}"`)

  if (!normalizedQuery) {
    return []
  }

  const cacheKey = bypassFilters ? `raw:${normalizedQuery}` : normalizedQuery
  const cached = bypassFilters ? null : getSearchCache(normalizedQuery, filtersVersion())

  if (cached !== null) {
    console.log(`[CACHE] Search: "${normalizedQuery}" - ${cached.length} results`)
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
  try {
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
    console.log(`[SEARCH] Found ${ids.length} candidates`)

    if (!ids.length) {
      if (!bypassFilters) setSearchCache(query, [], filtersVersion())
      return []
    }

    const details = await youtube<{ items: VideoItem[] }>('videos', {
      part: 'snippet,contentDetails,statistics,status',
      id: ids.join(',')
    })

    const songs = mapValidSongs(details.items ?? [], bypassFilters)

    console.log(`[FILTER] ${songs.length} suitable results`)
    songs.sort((a, b) => combinedScore(b, query) - combinedScore(a, query))
    if (!bypassFilters) {
      setSearchCache(query, songs, filtersVersion())
      console.log(`[CACHE] Saved "${query}" - ${songs.length} results`)
    }
    return songs
  } catch (error) {
    console.error('[ERROR] YouTube search:', error instanceof Error ? error.message : error)

    if (error instanceof AppError) throw error

    throw new AppError('YOUTUBE_ERROR', 'YouTube search failed')
  }
}

export function selectBestSong(songs: Song[], query: string): Song | null {
  if (!songs.length) {
    return null
  }

  const ranked = songs.map((song) => ({ song, score: combinedScore(song, query) })).sort((a, b) => b.score - a.score)
  const selected = ranked[0].song
  console.log(`[SELECT] "${selected.title}" - ${formatViews(selected.views)} views`)
  return selected
}

export { fetchPlaylistMeta }
export type { PlaylistMeta }

export async function fetchPlaylistSongs(playlistId: string): Promise<Song[]> {
  if (!playlistId) {
    return []
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

async function performPlaylistFetch(playlistId: string): Promise<Song[]> {
  try {
    console.log(`[PLAYLIST] Fetching playlist: ${playlistId}`)

    const videoIds: string[] = []
    const seenVideoIds = new Set<string>()
    const seenPageTokens = new Set<string>()

    let pageToken: string | undefined
    let page = 0

    do {
      page++

      if (page >= MAX_PLAYLIST_PAGES) {
        console.warn(`[PLAYLIST] Maximum page limit reached (${MAX_PLAYLIST_PAGES}), stopping`)
        break
      }

      if (pageToken) {
        if (seenPageTokens.has(pageToken)) {
          console.warn(`[PLAYLIST] Repeated page token detected, stopping pagination`)
          break
        }
        seenPageTokens.add(pageToken)
      }

      console.log(`[PLAYLIST] Loading page ${page}${pageToken ? `, token=${pageToken.slice(0, 10)}...` : ''}`)
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

      console.log(
        `[PLAYLIST] Page ${page}: ${items.length} items, ${newItems} new, ${duplicateItems} duplicates, total unique IDs: ${videoIds.length}`
      )

      const nextPageToken = playlist.nextPageToken
      if (nextPageToken && seenPageTokens.has(nextPageToken)) {
        console.warn(`[PLAYLIST] YouTube returned a repeated page token, stopping pagination`)
        break
      }

      pageToken = nextPageToken
    } while (pageToken)

    if (!videoIds.length) {
      console.log(`[PLAYLIST] No videos in playlist: ${playlistId}`)
      return []
    }

    console.log(`[PLAYLIST] Collected ${videoIds.length} unique video IDs, loading video details`)
    const allVideoItems: VideoItem[] = []
    const batches = chunk(videoIds, YOUTUBE_ID_BATCH_SIZE)

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]
      console.log(`[PLAYLIST] Loading video batch ${i + 1}/${batches.length} (${batch.length} videos)`)
      const details = await youtube<{ items: VideoItem[] }>('videos', {
        part: 'snippet,contentDetails,statistics,status',
        id: batch.join(',')
      })
      allVideoItems.push(...(details.items ?? []))
      console.log(`[PLAYLIST] Video batch ${i + 1}/${batches.length} complete, total details: ${allVideoItems.length}`)
    }

    const songs = mapValidSongs(allVideoItems)
    console.log(`[PLAYLIST] Fetched ${songs.length} valid unique songs from playlist: ${playlistId}`)
    return songs
  } catch (error) {
    console.error('[ERROR] Playlist fetch:', error instanceof Error ? error.message : error)
    if (error instanceof AppError) throw error
    throw new AppError('YOUTUBE_ERROR', 'failed to load YouTube playlist')
  }
}
