import { Song, Config, FilterFailureReason, AppError } from '../../core/types.js'
import { VideoItem } from '../../core/types.js'

const SHORTS_MAX_DURATION_SECONDS = 60

export const MUSIC_CATEGORY_ID = '10'

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

const isUpcoming = (video: VideoItem): boolean => video.snippet?.liveBroadcastContent === 'upcoming'
export const isLiveBroadcast = (video: VideoItem): boolean => Boolean(video.snippet?.liveBroadcastContent) && video.snippet!.liveBroadcastContent !== 'none'

type FilterRule = {
  reason: FilterFailureReason
  check: (song: Song, video: VideoItem, config: Config) => boolean
  message: string
  params?: (config: Config) => Record<string, string | number> | undefined
}

export const FILTER_RULES: FilterRule[] = [
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
    reason: 'NOT_PLAYABLE',
    check: (_s, v) => Boolean(v.status?.uploadStatus) && v.status!.uploadStatus !== 'processed',
    message: 'this video is not playable'
  },
  {
    reason: 'NOT_PLAYABLE',
    check: (_s, v) => isUpcoming(v),
    message: 'this video has not started yet'
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

export function getFilterFailureReason(song: Song, video: VideoItem, config: Config): FilterFailureReason | null {
  return FILTER_RULES.find((rule) => rule.check(song, video, config))?.reason ?? null
}

export function isValidSong(song: Song, video: VideoItem, config: Config): boolean {
  return getFilterFailureReason(song, video, config) === null
}

export function throwFilterError(reason: FilterFailureReason, config: Config): never {
  const rule = FILTER_RULES.find((r) => r.reason === reason)
  if (!rule) throw new AppError('YOUTUBE_ERROR', `no filter rule registered for reason: ${reason}`)
  throw new AppError(reason, rule.message, rule.params?.(config))
}
