import { getSecrets } from '../secrets.js'
import { getConfig } from '../config.js'
import { Song, AppError, Config, FilterFailureReason } from '../types.js'
import { VideoItem } from './types.js'
import { isoDurationToSeconds } from './scoring.js'

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

export const VIDEO_DETAILS_PART = 'snippet,contentDetails,statistics,status'

const FILTER_RULES: FilterRule[] = [
  {
    reason: 'NOT_MUSIC',
    check: (_s, v) => v.snippet?.categoryId !== '10',
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
    reason: 'NOT_PLAYABLE',
    check: (_s, v) => Boolean(v.status?.uploadStatus) && v.status!.uploadStatus !== 'processed',
    message: 'this video is not playable'
  },
  {
    reason: 'VIEWS_TOO_LOW',
    check: (s, _v, c) => s.views < c.minViews,
    message: 'this track does not have enough views',
    params: (c) => ({ min: c.minViews })
  },
  {
    reason: 'DURATION_OUT_OF_RANGE',
    check: (s, _v, c) => s.duration < c.minDurationSeconds || s.duration > c.maxDurationSeconds,
    message: "this track's duration is outside the allowed range",
    params: (c) => ({ min: c.minDurationSeconds, max: c.maxDurationSeconds })
  },
  {
    reason: 'IS_LIVE',
    check: (_s, v, c) => !c.allowLiveStreams && Boolean(v.snippet?.liveBroadcastContent) && v.snippet!.liveBroadcastContent !== 'none',
    message: 'live streams are not allowed'
  },
  {
    reason: 'IS_SHORT',
    check: (s, _v, c) => !c.allowShorts && isLikelyShort(s.duration),
    message: 'shorts are not allowed'
  }
]

export async function youtube<T>(path: string, params: Record<string, string>): Promise<T> {
  const { youtubeApiKey } = getSecrets()

  if (!youtubeApiKey) {
    throw new AppError('NO_API_KEY', 'YouTube API key is not configured, add it in the control panel')
  }

  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`)

  for (const [key, value] of Object.entries({ ...params, key: youtubeApiKey })) {
    url.searchParams.set(key, value)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(url, { signal: controller.signal })
    const data = (await response.json()) as T & YouTubeErrorResponse

    if (!response.ok) {
      const reason = data.error?.errors?.[0]?.reason

      if (reason === 'quotaExceeded') {
        throw new AppError('YOUTUBE_QUOTA', 'YouTube API quota exceeded')
      }

      throw new AppError('YOUTUBE_ERROR', data.error?.message || `YouTube API error ${response.status}`)
    }

    return data
  } finally {
    clearTimeout(timeout)
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
