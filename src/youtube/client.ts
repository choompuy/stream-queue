import { getSecrets } from '../secrets.js'
import { getConfig } from '../config.js'
import { Song, AppError, Config, FilterFailureReason } from '../types.js'
import { VideoItem } from './types.js'
import { isoDurationToSeconds } from './utils.js'

export type PlaylistMeta = {
  id: string
  title: string
  thumbnail: string
  itemCount: number
}

export type PlaylistFetchResult = { songs: Song[]; truncated: boolean }

type YouTubeErrorResponse = {
  error?: {
    code?: number
    errors?: Array<{ reason?: string }>
    message?: string
  }
}

type FilterRule = {
  reason: FilterFailureReason
  check: (song: Song, video: VideoItem, config: Config) => boolean
  message: string
  params?: (config: Config) => Record<string, string | number> | undefined
}

const SHORTS_MAX_DURATION_SECONDS = 60

export const VIDEO_DETAILS_PART = 'snippet,contentDetails,statistics,status,topicDetails'

// YouTube's own category for music
export const MUSIC_CATEGORY_ID = '10'

// The last part of the Wikipedia topic links YouTube uses for music (topicDetails.topicCategories).
// Many official clips are filed by the uploader under another category (Entertainment, People & Blogs) but still carry one of these
const MUSIC_TOPICS = new Set([
  'music',
  'christian_music',
  'classical_music',
  'country_music',
  'electronic_music',
  'hip_hop_music',
  'independent_music',
  'jazz',
  'music_of_asia',
  'music_of_latin_america',
  'pop_music',
  'reggae',
  'rhythm_and_blues',
  'rock_music',
  'soul_music'
])

export function isMusicVideo(video: VideoItem): boolean {
  if (video.snippet?.categoryId === MUSIC_CATEGORY_ID) return true

  return (video.topicDetails?.topicCategories ?? []).some((link) => {
    const topic = link.split('/').pop()?.toLowerCase()
    return topic !== undefined && MUSIC_TOPICS.has(topic)
  })
}

// 'live' or 'upcoming'; its duration is not known yet, so the duration rules do not apply to it
const isUpcoming = (video: VideoItem): boolean => video.snippet?.liveBroadcastContent === 'upcoming'
const isLiveBroadcast = (video: VideoItem): boolean => Boolean(video.snippet?.liveBroadcastContent) && video.snippet!.liveBroadcastContent !== 'none'

const FILTER_RULES: FilterRule[] = [
  {
    reason: 'NOT_MUSIC',
    check: (_s, v, c) => c.contentMode === 'music' && !isMusicVideo(v),
    message: 'this video is not categorized as Music'
  },
  {
    reason: 'NOT_PUBLIC',
    check: (_s, v) => Boolean(v.status?.privacyStatus) && v.status!.privacyStatus !== 'public',
    message: 'this video is not public'
  },
  {
    reason: 'NOT_EMBEDDABLE',
    check: (_s, v) => v.status?.embeddable === false,
    message: 'this video cannot be embedded'
  },
  {
    reason: 'REGION_BLOCKED',
    check: (_s, v, c) => !isAvailableInRegion(v, c.regionCode),
    message: 'this track is not available in the configured region'
  },
  {
    reason: 'AGE_RESTRICTED',
    check: (_s, v) => v.contentDetails?.contentRating?.ytRating === 'ytAgeRestricted',
    message: 'this video is age-restricted'
  },
  {
    // a scheduled stream or a premiere has nothing to play yet, whatever the setting for live streams says
    reason: 'NOT_PLAYABLE',
    check: (_s, v) => (Boolean(v.status?.uploadStatus) && v.status!.uploadStatus !== 'processed') || isUpcoming(v),
    message: 'this video is not playable'
  },
  {
    reason: 'IS_LIVE',
    check: (_s, v, c) => !c.allowLiveStreams && isLiveBroadcast(v),
    message: 'live streams are not allowed'
  },
  {
    reason: 'VIEWS_TOO_LOW',
    check: (s, _v, c) => s.views < c.minViews,
    message: 'this track does not have enough views',
    params: (c) => ({ min: c.minViews })
  },
  {
    reason: 'DURATION_OUT_OF_RANGE',
    check: (s, v, c) => !isLiveBroadcast(v) && (s.duration < c.minDurationSeconds || s.duration > c.maxDurationSeconds),
    message: "this track's duration is outside the allowed range",
    params: (c) => ({ min: c.minDurationSeconds, max: c.maxDurationSeconds })
  },
  {
    reason: 'IS_SHORT',
    check: (s, _v, c) => !c.allowShorts && isLikelyShort(s.duration),
    message: 'shorts are not allowed'
  }
]

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504])
const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 500

// The request never reached YouTube (no key, no network), so YouTube cannot have charged quota for it
export class RequestNotSentError extends AppError {}

const isTimeout = (error: unknown): boolean => error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')

export async function youtube<T>(path: string, params: Record<string, string>, { attempts = MAX_ATTEMPTS }: { attempts?: number } = {}): Promise<T> {
  const { youtubeApiKey } = getSecrets()

  if (!youtubeApiKey) {
    throw new RequestNotSentError('NO_API_KEY', 'YouTube API key is not configured, add it in the control panel')
  }

  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`)

  for (const [key, value] of Object.entries({ ...params, key: youtubeApiKey })) {
    url.searchParams.set(key, value)
  }

  // a timeout, a network error, a 429 and a 5xx are tried again (with growing pauses) while attempts are left
  for (let attempt = 1; ; attempt++) {
    let response: Response
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    } catch (error) {
      if (attempt >= attempts) {
        const message = `YouTube API is unreachable: ${error instanceof Error ? error.message : error}`
        // a timeout may have reached YouTube, anything else (DNS, no route, refused) did not
        throw isTimeout(error) ? new AppError('YOUTUBE_ERROR', message) : new RequestNotSentError('YOUTUBE_ERROR', message)
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt))
      continue
    }

    if (RETRY_STATUSES.has(response.status) && attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt))
      continue
    }

    // an error page is not always JSON
    const data = (await response.json().catch(() => ({}))) as T & YouTubeErrorResponse

    if (!response.ok) {
      const reason = data.error?.errors?.[0]?.reason

      if (reason === 'quotaExceeded') {
        throw new AppError('YOUTUBE_QUOTA', 'YouTube API quota exceeded')
      }

      throw new AppError('YOUTUBE_ERROR', data.error?.message || `YouTube API error ${response.status}`)
    }

    return data
  }
}

export function videoToSong(video: VideoItem): Song {
  return {
    videoId: video.id,
    title: video.snippet?.title ?? 'Unknown title',
    channelTitle: video.snippet?.channelTitle ?? 'Unknown channel',
    thumbnail: video.snippet?.thumbnails?.medium?.url ?? '',
    duration: isoDurationToSeconds(video.contentDetails?.duration),
    views: Number(video.statistics?.viewCount ?? 0),
    url: `https://www.youtube.com/watch?v=${video.id}`
  }
}

export async function fetchPlaylistMeta(playlistId: string): Promise<PlaylistMeta | null> {
  const data = await youtube<{
    items: Array<{ id: string; snippet?: { title?: string; thumbnails?: { medium?: { url?: string } } }; contentDetails?: { itemCount?: number } }>
  }>('playlists', { part: 'snippet,contentDetails', id: playlistId })

  const item = data.items?.[0]
  if (!item) return null

  return {
    id: item.id,
    title: item.snippet?.title ?? 'Untitled playlist',
    thumbnail: item.snippet?.thumbnails?.medium?.url ?? '',
    itemCount: item.contentDetails?.itemCount ?? 0
  }
}

export function isAvailableInRegion(video: VideoItem, regionCode: string): boolean {
  if (!regionCode) return true

  const restriction = video.contentDetails?.regionRestriction
  if (!restriction) return true

  if (restriction.blocked?.includes(regionCode)) return false
  if (restriction.allowed && (restriction.allowed.length === 0 || !restriction.allowed.includes(regionCode))) return false

  return true
}

function isLikelyShort(durationSeconds: number): boolean {
  return durationSeconds > 0 && durationSeconds <= SHORTS_MAX_DURATION_SECONDS
}

export function getFilterFailureReason(song: Song, video: VideoItem): FilterFailureReason | null {
  const config = getConfig()
  return FILTER_RULES.find((rule) => rule.check(song, video, config))?.reason ?? null
}

export function isValidSong(song: Song, video: VideoItem): boolean {
  return getFilterFailureReason(song, video) === null
}

export function throwFilterError(reason: FilterFailureReason, config: Config): never {
  const rule = FILTER_RULES.find((r) => r.reason === reason)
  if (!rule) throw new AppError('YOUTUBE_ERROR', `no filter rule registered for reason: ${reason}`)
  throw new AppError(reason, rule.message, rule.params?.(config))
}

const BATCH_SIZE = 50

export async function fetchVideos(ids: string[]): Promise<VideoItem[]> {
  const found = new Map<string, VideoItem>()

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const { items } = await youtube<{ items?: VideoItem[] }>('videos', { part: VIDEO_DETAILS_PART, id: ids.slice(i, i + BATCH_SIZE).join(',') })
    for (const video of items ?? []) found.set(video.id, video)
  }

  // videos.list answers in no guaranteed order: the caller's order (search relevance, playlist position) is kept
  return ids.flatMap((id) => found.get(id) ?? [])
}
