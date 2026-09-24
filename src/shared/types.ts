export type Song = {
  videoId: string
  title: string
  channelTitle: string
  thumbnail: string
  duration: number
  views: number
  url: string
}

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

export type ApiError = { success: false; error: string; code: string; params?: Record<string, string | number> }
export type ApiOk<T> = { success: true; data: T }
export type ApiResult<T> = ApiOk<T> | ApiError

export type Config = {
  minViews: number
  minDurationSeconds: number
  maxDurationSeconds: number
  maxQueueSize: number
  maxRequestsPerUser: number
  regionCode: string
  allowShorts: boolean
  allowLiveStreams: boolean
  fallbackPlaylist: any
  twitch: {
    clientId: string
    clientSecret: string
  }
}

export type Settings = {
  showVideo: boolean
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  locale: 'en' | 'ru'
}

export type CacheFile = {
  searches: Record<string, any>
  videos: Record<string, any>
  quota: {
    date: string
    searches: number
  }
}

export type TwitchConnectionResponse = {
  connected: boolean
  user: { displayName: string; login: string } | null
  connectedAt: number | null
}

export type TwitchAuthResponse = {
  authUrl: string
}

export type TwitchCallbackResponse = {
  success: boolean
  user: { displayName: string; login: string }
}

export type SecretsResponse = { youtubeApiKey: string; hasYoutubeApiKey: boolean; twitchConnected: boolean; twitchUser: { displayName: string; login: string } | null }
export type SettingsResponse = Settings
export type OverlayStateResponse = { state: any; settings: Settings }
export type ConfigResponse = Config
export type SearchResponse = { results: Song[] }