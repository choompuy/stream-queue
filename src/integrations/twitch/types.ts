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

export type TwitchConnectionStatus = {
  connected: boolean
  user: TwitchUserInfo | null
  connectedAt: number | null
}

export type TwitchAuthConfig = {
  clientId: string
  clientSecret: string
  redirectUri: string
  scopes: string[]
}

export type TwitchOAuthOptions = Partial<TwitchAuthConfig> & {
  onTokenUpdated?: (tokenData: TwitchTokenData) => void
}

export type TwitchSecretsUpdates = Partial<TwitchSecrets>

export type TwitchSecrets = {
  clientId: string | null
  clientSecret: string | null
  tokenData: TwitchTokenData | null
  userInfo: TwitchUserInfo | null
  connectedAt: number | null
}

export type TwitchErrorResponse = {
  error: string
  status: number
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

export type TwitchChannelPointsRedemption = {
  id: string
  broadcaster_user_id: string
  broadcaster_user_login: string
  broadcaster_user_name: string
  user_id: string
  user_login: string
  user_name: string
  user_input: string
  reward: {
    id: string
    title: string
    cost: number
    prompt: string
  }
  redeemed_at: string
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
