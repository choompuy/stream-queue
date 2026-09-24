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