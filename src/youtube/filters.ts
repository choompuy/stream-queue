import { Song, AppError, Config, FilterFailureReason } from '../types.js'
import { VideoItem } from './types.js'

type FilterRule = {
  reason: FilterFailureReason
  guard?: boolean
  check: (song: Song, video: VideoItem, config: Config) => boolean
  params?: (config: Config) => Record<string, string | number> | undefined
}

// The parts the video fetch asks for: what the rules below read (plus what the mapper shows)
export const VIDEO_DETAILS_PART = 'snippet,contentDetails,statistics,status,topicDetails'

// Of those parts, only what something reads: YouTube leaves the rest (the description, the tags, the localized texts) out of
// the answer, and it is the raw answer that the cache keeps. A field read anywhere but listed here would arrive undefined:
// tests/backend/youtube/fields.test.ts runs the filters and the mapper on answers cut down by this very selector
export const VIDEO_DETAILS_FIELDS =
  'items(id,snippet(title,channelTitle,categoryId,liveBroadcastContent,thumbnails/medium/url),topicDetails/topicCategories,' +
  'contentDetails(duration,regionRestriction,contentRating/ytRating),statistics/viewCount,status(embeddable,privacyStatus,uploadStatus))'

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

// 'none' means the video is not a broadcast; anything else is one
const isLiveBroadcast = (video: VideoItem): boolean => {
  const live = video.snippet?.liveBroadcastContent
  return live !== undefined && live !== 'none'
}

const isNotPublic = (video: VideoItem): boolean => {
  const privacy = video.status?.privacyStatus
  return privacy !== undefined && privacy !== 'public'
}

// A broadcast answers to the live-stream rules, not to the upload status: while it is on, YouTube reports
// its upload as 'uploaded', and only the recording becomes 'processed' once the stream is over
const isNotProcessed = (video: VideoItem): boolean => {
  const upload = video.status?.uploadStatus
  return upload !== undefined && upload !== 'processed' && !isLiveBroadcast(video)
}

const FILTER_RULES: FilterRule[] = [
  {
    reason: 'NOT_MUSIC',
    check: (_s, v, c) => c.contentMode === 'music' && !isMusicVideo(v)
  },
  {
    reason: 'NOT_PUBLIC',
    guard: true,
    check: (_s, v) => isNotPublic(v)
  },
  {
    reason: 'NOT_EMBEDDABLE',
    guard: true,
    check: (_s, v) => v.status?.embeddable === false
  },
  {
    reason: 'REGION_BLOCKED',
    guard: true,
    check: (_s, v, c) => !isAvailableInRegion(v, c.regionCode)
  },
  {
    reason: 'AGE_RESTRICTED',
    guard: true,
    check: (_s, v) => v.contentDetails?.contentRating?.ytRating === 'ytAgeRestricted'
  },
  {
    // a scheduled stream or a premiere has nothing to play yet, whatever the setting for live streams says
    reason: 'NOT_PLAYABLE',
    guard: true,
    check: (_s, v) => isNotProcessed(v) || isUpcoming(v)
  },
  {
    reason: 'IS_LIVE',
    check: (_s, v, c) => !c.allowLiveStreams && isLiveBroadcast(v)
  },
  {
    reason: 'VIEWS_TOO_LOW',
    check: (s, _v, c) => s.views < c.minViews,
    params: (c) => ({ min: c.minViews })
  },
  {
    reason: 'DURATION_OUT_OF_RANGE',
    check: (s, v, c) => !isLiveBroadcast(v) && (s.duration < c.minDurationSeconds || s.duration > c.maxDurationSeconds),
    params: (c) => ({ min: c.minDurationSeconds, max: c.maxDurationSeconds })
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

/**
 * The one filter check: the first rule a track fails becomes the error the API and the chat answer with.
 * `guardOnly` limits the check to the guard rules: the streamer's own playlist answers to those alone, what
 * the viewer rules would trim away there is the streamer's own choice. A rule's user-facing text lives in
 * the locales and is looked up by the code, so the error carries only the params a rule's translation needs
 */
export function checkFilters(song: Song, video: VideoItem, config: Config, guardOnly = false): AppError | null {
  const rules = guardOnly ? FILTER_RULES.filter((rule) => rule.guard) : FILTER_RULES
  const rule = rules.find((rule) => rule.check(song, video, config))
  return rule ? new AppError(rule.reason, undefined, rule.params?.(config)) : null
}
