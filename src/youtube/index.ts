import { Song, AppError } from '../types.js'
import { youtube, fetchPlaylistMeta, VIDEO_DETAILS_PART, RequestNotSentError } from './client.js'
import { videoToSong } from './mapper.js'
import { isValidSong, getFilterFailureReason, throwFilterError, MUSIC_CATEGORY_ID } from './filters.js'
import { normalize, combinedScore, formatViews } from './scoring.js'
import { getSearchCache, setSearchCache, getVideoCache, setVideoCache, reserveSearchQuota, releaseSearchQuota, CACHE_LIMITS } from './cache.js'
import { VideoItem, SearchItem, PlaylistItem } from './types.js'
import { getConfig } from '../config.js'
import { createLogger, describeError } from '../logger.js'

export type PlaylistMeta = {
  id: string
  title: string
  thumbnail: string
  itemCount: number
}

export type PlaylistFetchResult = { songs: Song[]; truncated: boolean }

export { fetchPlaylistMeta, VIDEO_DETAILS_PART, RequestNotSentError } from './client.js'
export { MUSIC_CATEGORY_ID, isLiveBroadcast } from './filters.js'

const pendingSearches = new Map<string, Promise<Song[]>>()
const pendingVideos = new Map<string, Promise<Song | null>>()
const pendingPlaylists = new Map<string, Promise<PlaylistFetchResult>>()
const YOUTUBE_ID_BATCH_SIZE = 50
const PLAYLIST_PAGE_SIZE = 50
const MAX_PLAYLIST_PAGES = 3

const log = createLogger('YOUTUBE')

// shown with LOG_LEVEL=debug
const debugLog = (message: string): void => log.debug(message)

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

  if (existing) {
    return existing
  }

  const request = run()
  pending.set(key, request)
  return request.finally(() => pending.delete(key))
}

function filtersVersion(): string {
  const c = getConfig()
  return `${c.minViews}:${c.minDurationSeconds}:${c.maxDurationSeconds}:${c.regionCode}:${c.allowShorts}:${c.allowLiveStreams}:${c.contentMode}`
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
      const reason = getFilterFailureReason(song, video, getConfig())
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

  return dedupInFlight(pendingSearches, cacheKey, () => performSearch(normalizedQuery, bypassFilters))
}

function mapValidSongs(videos: VideoItem[], bypassFilters = false): Song[] {
  const config = getConfig()
  return videos
    .map((video) => ({ video, song: videoToSong(video) }))
    .filter(({ video, song }) => bypassFilters || isValidSong(song, video, config))
    .map(({ song }) => song)
}

async function performSearch(query: string, bypassFilters: boolean): Promise<Song[]> {
  return withYouTubeErrorHandling('YouTube search', async () => {
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

/**
 * The best match of a result list from searchSongs(). That list is already sorted best-first by the score that also
 * counts YouTube's own relevance rank, which is only known during the search: scoring the songs again here, without
 * it, could pick a different track than the one the list shows first.
 */
export function selectBestSong(songs: Song[], isAvailable: (song: Song) => boolean = () => true): Song | null {
  const selected = songs.find(isAvailable) ?? songs[0]
  if (!selected) return null

  debugLog(`[SELECT] "${selected.title}" - ${formatViews(selected.views)} views`)
  return selected
}

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

      if (pageToken) {
        if (seenPageTokens.has(pageToken)) {
          log.warn('Playlist: repeated page token detected, stopping pagination')
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

      pageToken = playlist.nextPageToken

      // the limit is checked after a page was loaded, so exactly MAX_PLAYLIST_PAGES pages are read, and "truncated" means there was more
      if (pageToken && page >= MAX_PLAYLIST_PAGES) {
        log.warn(`Playlist: maximum page limit reached (${MAX_PLAYLIST_PAGES}), the rest is not loaded`)
        truncated = true
        break
      }
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

    // videos.list answers in no guaranteed order: the playlist keeps its own
    const position = new Map(videoIds.map((id, index) => [id, index]))
    allVideoItems.sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0))

    const songs = mapValidSongs(allVideoItems)
    debugLog(`[PLAYLIST] Fetched ${songs.length} valid unique songs from playlist: ${playlistId}`)
    return { songs, truncated }
  })
}
