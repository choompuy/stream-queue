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

type YouTubeErrorResponse = {
  error?: {
    code?: number
    errors?: Array<{ reason?: string }>
    message?: string
  }
}

const SHORTS_MAX_DURATION_SECONDS = 60

export async function youtube<T>(path: string, params: Record<string, string>): Promise<T> {
  const { youtubeApiKey } = getSecrets()

  if (!youtubeApiKey) {
    throw new AppError('NO_API_KEY', 'YouTube API key is not configured, add it in the control panel')
  }

  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`)

  for (const [key, value] of Object.entries({ ...params, key: youtubeApiKey })) {
    url.searchParams.set(key, value)
  }

  const response = await fetch(url)
  const data = (await response.json()) as T & YouTubeErrorResponse

  if (!response.ok) {
    const reason = data.error?.errors?.[0]?.reason

    if (reason === 'quotaExceeded') {
      throw new AppError('YOUTUBE_QUOTA', 'YouTube API quota exceeded')
    }

    throw new AppError('YOUTUBE_ERROR', data.error?.message || `YouTube API error ${response.status}`)
  }

  return data
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
  if (restriction.allowed && !restriction.allowed.includes(regionCode)) return false

  return true
}

function isLikelyShort(durationSeconds: number): boolean {
  return durationSeconds > 0 && durationSeconds <= SHORTS_MAX_DURATION_SECONDS
}

export function getFilterFailureReason(song: Song, video: VideoItem): FilterFailureReason | null {
  const config = getConfig()

  // Required
  if (video.snippet?.categoryId !== '10') return 'NOT_MUSIC'
  if (video.status?.privacyStatus && video.status.privacyStatus !== 'public') return 'NOT_PUBLIC'
  if (video.status?.embeddable === false) return 'NOT_EMBEDDABLE'
  if (!isAvailableInRegion(video, config.regionCode)) return 'REGION_BLOCKED'
  if (video.contentDetails?.contentRating?.ytRating === 'ytAgeRestricted') return 'AGE_RESTRICTED'
  if (video.status?.uploadStatus && video.status.uploadStatus !== 'processed') return 'NOT_PLAYABLE'

  // Optional
  if (song.views < config.minViews) return 'VIEWS_TOO_LOW'
  if (song.duration < config.minDurationSeconds || song.duration > config.maxDurationSeconds) return 'DURATION_OUT_OF_RANGE'
  if (!config.allowLiveStreams && video.snippet?.liveBroadcastContent && video.snippet.liveBroadcastContent !== 'none') return 'IS_LIVE'
  if (!config.allowShorts && isLikelyShort(song.duration)) return 'IS_SHORT'

  return null
}

export function isValidSong(song: Song, video: VideoItem): boolean {
  return getFilterFailureReason(song, video) === null
}

export function throwFilterError(reason: FilterFailureReason, config: Config): never {
  switch (reason) {
    case 'NOT_MUSIC':
      throw new AppError('NOT_MUSIC', 'this video is not categorized as Music')
    case 'NOT_EMBEDDABLE':
      throw new AppError('NOT_EMBEDDABLE', 'this video cannot be embedded')
    case 'DURATION_OUT_OF_RANGE':
      throw new AppError('DURATION_OUT_OF_RANGE', "this track's duration is outside the allowed range", {
        min: config.minDurationSeconds,
        max: config.maxDurationSeconds
      })
    case 'VIEWS_TOO_LOW':
      throw new AppError('VIEWS_TOO_LOW', 'this track does not have enough views', {
        min: config.minViews
      })
    case 'REGION_BLOCKED':
      throw new AppError('REGION_BLOCKED', 'this track is not available in the configured region')
    case 'NOT_PUBLIC':
      throw new AppError('NOT_PUBLIC', 'this video is not public')
    case 'AGE_RESTRICTED':
      throw new AppError('AGE_RESTRICTED', 'this video is age-restricted')
    case 'NOT_PLAYABLE':
      throw new AppError('NOT_PLAYABLE', 'this video is not playable')
    case 'IS_LIVE':
      throw new AppError('IS_LIVE', 'live streams are not allowed')
    case 'IS_SHORT':
      throw new AppError('IS_SHORT', 'shorts are not allowed')
  }
}
