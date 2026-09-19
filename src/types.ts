export type ActivityStatus = 'accepted' | 'rejected' | 'failed'
export type ActivityEntry = {
  requestedBy: string
  query: string
  title: string | null
  videoId: string | null
  status: ActivityStatus
  reasonCode: string | null
  reasonParams?: Record<string, string | number>
  at: number
}

export type Config = {
  minViews: number
  minDurationSeconds: number
  maxDurationSeconds: number
  maxQueueSize: number
  maxRequestsPerUser: number
  regionCode: string
  allowShorts: boolean
  allowLiveStreams: boolean
  fallbackPlaylist: FallbackPlaylist
}

export type FallbackPlaylist = {
  playlistId: string | null
  enabled: boolean
  shuffle: boolean
  repeat: boolean
}

export type Settings = {
  showVideo: boolean
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  locale: 'en' | 'ru'
}

export type Song = {
  videoId: string
  title: string
  channelTitle: string
  thumbnail: string
  duration: number
  views: number
  url: string
}

export type QueueItem = Song & {
  requestedBy: string
  isFallback?: boolean
}

export type PlayerState = {
  current: QueueItem | null
  queue: QueueItem[]
  isPaused: boolean
}

type SearchCacheEntry = {
  results: Song[]
  expiresAt: number
  filtersVersion: string
}

type VideoCacheEntry = {
  song: Song | null
  reason: FilterFailureReason | null
  expiresAt: number
  filtersVersion: string
}

export type CacheFile = {
  searches: Record<string, SearchCacheEntry>
  videos: Record<string, VideoCacheEntry>
  quota: {
    date: string
    searches: number
  }
}

export type ApiError = { success: false; error: string; code: string; params?: Record<string, string | number> }
export type ApiOk<T> = { success: true } & T
export type ApiResult<T> = ApiOk<T> | ApiError

export type FilterFailureReason =
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

export type AppErrorCode =
  | 'DUPLICATE'
  | 'BLOCKED'
  | 'QUEUE_FULL'
  | 'USER_LIMIT'
  | 'YOUTUBE_QUOTA'
  | 'YOUTUBE_ERROR'
  | 'NO_API_KEY'
  | FilterFailureReason
export class AppError extends Error {
  constructor(
    public code: AppErrorCode,
    message: string,
    public params?: Record<string, string | number>
  ) {
    super(message)
  }
}

export type StateResponse = PlayerState & { nextTrack: QueueItem | null }
export type PlayerActionResponse = StateResponse & { message: string }
export type SettingsResponse = Settings
export type OverlayStateResponse = { state: PlayerState; settings: Settings }
export type ConfigResponse = Config & { fallbackPlaylistWarning?: string }
export type SearchResponse = { results: Song[] }
export type QueueRequestResponse = {
  message: string
  song: QueueItem
  started: boolean
  position: number
  state: PlayerState
}
export type FallbackStateResponse = FallbackPlaylist & {
  lastRefreshedAt: number | null
  upNext: Song[]
  sourceCount: number
  activeVideoId: string | null
}
export type QueueRemoveResponse = { removed: QueueItem; state: PlayerState }
export type SecretsResponse = { youtubeApiKey: string; hasYoutubeApiKey: boolean }
export type ActivityResponse = { entries: ActivityEntry[] }
