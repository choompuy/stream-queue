export type ActivityReasonCode =
  | 'DUPLICATE'
  | 'BLOCKED'
  | 'QUEUE_FULL'
  | 'USER_LIMIT'
  | 'YOUTUBE_QUOTA'
  | 'YOUTUBE_ERROR'
  | 'NO_API_KEY'
  | 'NOT_MUSIC'
  | 'NOT_PUBLIC'
  | 'NOT_EMBEDDABLE'
  | 'AGE_RESTRICTED'
  | 'REGION_BLOCKED'
  | 'NOT_PLAYABLE'
  | 'IS_LIVE'
  | 'IS_SHORT'
  | 'DURATION_OUT_OF_RANGE'
  | 'VIEWS_TOO_LOW'
  | 'INVALID_YOUTUBE_URL'
  | 'SONG_NOT_FOUND'
  | 'SERVER_ERROR'
  | 'PLAYBACK_VIDEO_UNAVAILABLE'
  | 'PLAYBACK_EMBED_DISALLOWED'
  | 'PLAYBACK_FAILED'

export type ActivityStatus = 'accepted' | 'rejected' | 'failed'
export type ActivityEntry = {
  requestedBy: string
  query: string
  title: string | null
  videoId: string | null
  status: ActivityStatus
  reasonCode: ActivityReasonCode | null
  reasonParams?: Record<string, string | number>
  at: number
}

export type ActivityResponse = { entries: ActivityEntry[] }