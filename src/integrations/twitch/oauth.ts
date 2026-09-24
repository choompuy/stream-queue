import type { TwitchTokenData, TwitchAuthConfig, TwitchTokenResponse, TwitchErrorResponse } from './types.js'

const DEFAULT_SCOPES = ['channel:read:subscriptions', 'chat:read', 'chat:edit', 'channel:moderate']

function log(message: string): void {
  console.log(`[TWITCH OAUTH] ${message}`)
}

function logError(message: string): void {
  console.error(`[TWITCH OAUTH] ${message}`)
}

export class TwitchOAuth {
  private config: TwitchAuthConfig
  private tokenData: TwitchTokenData | null = null

  constructor(config: Partial<TwitchAuthConfig> = {}) {
    this.config = {
      clientId: config.clientId || process.env.TWITCH_CLIENT_ID || '',
      clientSecret: config.clientSecret || process.env.TWITCH_CLIENT_SECRET || '',
      redirectUri: config.redirectUri || 'http://localhost:3000/api/integrations/twitch/callback',
      scopes: config.scopes || DEFAULT_SCOPES
    }

    if (!this.config.clientId) {
      log('Twitch client ID not configured')
    }
  }

  getConfig(): TwitchAuthConfig {
    return { ...this.config }
  }

  getAuthUrl(): string {
    if (!this.config.clientId) {
      throw new Error('Twitch client ID not configured')
    }

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: this.config.scopes.join(' '),
      force_verify: 'true'
    })

    return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`
  }

  async exchangeCodeForToken(code: string): Promise<TwitchTokenData> {
    if (!this.config.clientId || !this.config.clientSecret) {
      throw new Error('Twitch client credentials not configured')
    }

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: this.config.redirectUri
    })

    try {
      const response = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      })

      if (!response.ok) {
        const error = (await response.json()) as TwitchErrorResponse
        throw new Error(`OAuth token exchange failed: ${error.message}`)
      }

      const data = (await response.json()) as TwitchTokenResponse

      this.tokenData = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + data.expires_in * 1000,
        scope: data.scope
      }

      log('Token exchange successful')
      return this.tokenData
    } catch (error) {
      logError(`Token exchange failed: ${error instanceof Error ? error.message : error}`)
      throw error
    }
  }

  async refreshAccessToken(): Promise<TwitchTokenData> {
    if (!this.tokenData?.refreshToken) {
      throw new Error('No refresh token available')
    }

    if (!this.config.clientId || !this.config.clientSecret) {
      throw new Error('Twitch client credentials not configured')
    }

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: this.tokenData.refreshToken
    })

    try {
      const response = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      })

      if (!response.ok) {
        const error = (await response.json()) as TwitchErrorResponse
        throw new Error(`Token refresh failed: ${error.message}`)
      }

      const data = (await response.json()) as TwitchTokenResponse

      this.tokenData = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + data.expires_in * 1000,
        scope: data.scope
      }

      log('Token refresh successful')
      return this.tokenData
    } catch (error) {
      logError(`Token refresh failed: ${error instanceof Error ? error.message : error}`)
      throw error
    }
  }

  getAccessToken(): string | null {
    if (!this.tokenData) return null

    // Check if token is expired or will expire soon (5 minutes buffer)
    if (Date.now() >= this.tokenData.expiresAt - 5 * 60 * 1000) {
      return null
    }

    return this.tokenData.accessToken
  }

  setTokenData(tokenData: TwitchTokenData): void {
    this.tokenData = tokenData
    log('Token data set from storage')
  }

  getTokenData(): TwitchTokenData | null {
    return this.tokenData
  }

  clearTokenData(): void {
    this.tokenData = null
    log('Token data cleared')
  }

  isAuthenticated(): boolean {
    return this.getAccessToken() !== null
  }

  needsRefresh(): boolean {
    if (!this.tokenData) return false
    return Date.now() >= this.tokenData.expiresAt - 5 * 60 * 1000
  }
}
