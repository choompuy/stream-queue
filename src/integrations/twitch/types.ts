export type TwitchTokenData = {
  accessToken: string
  refreshToken: string
  expiresAt: number
  scope: string[]
}

export type TwitchUserInfo = {
  id: string
  login: string
  displayName: string
  profileImageUrl: string
}

export type TwitchAuthConfig = {
  clientId: string
  clientSecret: string
  scopes: string[]
}

export type TwitchOAuthOptions = {
  clientId: string
  clientSecret: string
  scopes?: string[]
  onTokenUpdated?: (tokenData: TwitchTokenData) => void
}

export type TwitchDeviceCodeResponse = {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

export type TwitchSecrets = {
  tokenData: TwitchTokenData | null
  userInfo: TwitchUserInfo | null
  connectedAt: number | null
}

export type TwitchErrorResponse = {
  status: string
  message: string
}

export type TwitchTokenResponse = {
  access_token: string
  refresh_token: string
  expires_in: number
  scope: string[]
  token_type: string
}

export type TwitchUsersResponse = {
  data: Array<{
    id: string
    login: string
    display_name: string
    profile_image_url: string
  }>
}

export type TwitchRedemptionStatus = 'UNFULFILLED' | 'FULFILLED' | 'CANCELED'
export type TwitchRedemptionUpdateStatus = 'FULFILLED' | 'CANCELED'

export type TwitchChannelPointsRedemption = {
  id: string
  broadcaster_user_id: string
  broadcaster_user_login: string
  broadcaster_user_name: string
  user_id: string
  user_login: string
  user_name: string
  user_input: string
  status: TwitchRedemptionStatus
  redeemed_at: string
  reward: {
    id: string
    title: string
    cost: number
    prompt: string
  }
}

export type TwitchRedemptionsResponse = {
  data: TwitchChannelPointsRedemption[]
}

export type TwitchCustomReward = {
  id: string
  title: string
  cost: number
  prompt: string
  is_enabled: boolean
  is_user_input_required: boolean
  background_color?: string
  is_max_per_stream_enabled?: boolean
  max_per_stream?: number
  is_max_per_user_per_stream_enabled?: boolean
  max_per_user_per_stream?: number
  is_global_cooldown_enabled?: boolean
  global_cooldown_seconds?: number
}

export type TwitchCreateCustomReward = {
  title: string
  cost: number
  prompt?: string
  is_enabled?: boolean
  background_color?: string
  is_user_input_required?: boolean
  is_max_per_stream_enabled?: boolean
  max_per_stream?: number
  is_max_per_user_per_stream_enabled?: boolean
  max_per_user_per_stream?: number
  is_global_cooldown_enabled?: boolean
  global_cooldown_seconds?: number
}

export type TwitchUpdateCustomReward = {
  title?: string
  cost?: number
  prompt?: string
  is_enabled?: boolean
  background_color?: string
  is_user_input_required?: boolean
  is_max_per_stream_enabled?: boolean
  max_per_stream?: number
  is_max_per_user_per_stream_enabled?: boolean
  max_per_user_per_stream?: number
  is_global_cooldown_enabled?: boolean
  global_cooldown_seconds?: number
}

export type TwitchCreateCustomRewardResponse = {
  data: TwitchCustomReward[]
}

export type TwitchCustomRewardsResponse = {
  data: TwitchCustomReward[]
}

export type EventSubMessage = {
  metadata: {
    message_id: string
    message_type: 'session_welcome' | 'session_keepalive' | 'notification' | 'session_reconnect' | 'revocation'
    message_timestamp: string
  }
  payload: {
    session?: {
      id: string
      status: string
      keepalive_timeout_seconds: number
      reconnect_url?: string
    }
    subscription?: {
      id: string
      type: string
      version: string
      status: string
      condition: Record<string, string>
    }
    event?: unknown
  }
}

export type TwitchChatMessage = {
  channel: string
  displayName: string
  userLogin: string
  text: string
  isModerator: boolean
  isBroadcaster: boolean
}

export type TwitchChatPermission = 'everyone' | 'moderator' | 'broadcaster'

export type TwitchChatCommandConfig = {
  enabled: boolean
  command: string
  permission: TwitchChatPermission
}

export type TwitchChatCommandsConfig = {
  now: TwitchChatCommandConfig
  queue: TwitchChatCommandConfig
  skip: TwitchChatCommandConfig
  pause: TwitchChatCommandConfig
  resume: TwitchChatCommandConfig
  controlCooldownSeconds: number
  plainCooldownSeconds: number
}

export type TwitchConfig = {
  channelPointsRewardId: string | null
  autoFulfillRedemptions: boolean
  chatCommands: TwitchChatCommandsConfig
}

export type TwitchConnectionResponse = {
  configured: boolean
  connected: boolean
  user: { displayName: string; login: string } | null
  connectedAt: number | null
}
