import type { TwitchTokenData, TwitchAuthConfig, TwitchTokenResponse, TwitchErrorResponse, TwitchOAuthOptions } from './types.js'

const DEFAULT_SCOPES = ['chat:read', 'chat:edit']
const REFRESH_BUFFER_MS = 5 * 60 * 1000

function log(message: string): void {
  console.log(`[TWITCH OAUTH] ${message}`)
}

function logError(message: string): void {
  console.error(`[TWITCH OAUTH] ${message}`)
}

export class TwitchOAuth {
  private config: TwitchAuthConfig
  private tokenData: TwitchTokenData | null = null
  private refreshPromise: Promise<TwitchTokenData> | null = null
  private onTokenUpdated?: (tokenData: TwitchTokenData) => void

  constructor(config: TwitchOAuthOptions = {}) {
    this.config = {
      clientId: config.clientId || '',
      clientSecret: config.clientSecret || '',
      redirectUri: config.redirectUri || 'http://localhost:3000/api/integrations/twitch/callback',
      scopes: config.scopes || DEFAULT_SCOPES
    }

    this.onTokenUpdated = config.onTokenUpdated

    if (!this.config.clientId) log('Twitch client ID not configured')
  }

  getConfig(): TwitchAuthConfig {
    return {
      ...this.config,
      scopes: [...this.config.scopes]
    }
  }

  getAuthUrl(state: string): string {
    if (!this.config.clientId) throw new Error('Twitch client ID not configured')
    if (!state) throw new Error('OAuth state is required')

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: this.config.scopes.join(' '),
      state,
      force_verify: 'true'
    })

    return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`
  }

  async exchangeCodeForToken(code: string): Promise<TwitchTokenData> {
    if (!this.config.clientId || !this.config.clientSecret) throw new Error('Twitch client credentials not configured')
    if (!code) throw new Error('OAuth code is required')

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

      if (!response.ok) throw await this.createOAuthError(response, 'OAuth token exchange failed')

      const data = (await response.json()) as TwitchTokenResponse
      this.tokenData = this.createTokenData(data)
      this.onTokenUpdated?.(this.tokenData)
      log('Token exchange successful')
      return this.tokenData
    } catch (error) {
      logError(`Token exchange failed: ${error instanceof Error ? error.message : error}`)
      throw error
    }
  }

  async refreshAccessToken(): Promise<TwitchTokenData> {
    if (this.refreshPromise) return this.refreshPromise
    if (!this.tokenData?.refreshToken) throw new Error('No refresh token available')
    if (!this.config.clientId || !this.config.clientSecret) throw new Error('Twitch client credentials not configured')

    this.refreshPromise = this.performRefresh()

    try {
      return await this.refreshPromise
    } finally {
      this.refreshPromise = null
    }
  }

  private async performRefresh(): Promise<TwitchTokenData> {
    const refreshToken = this.tokenData?.refreshToken
    if (!refreshToken) throw new Error('No refresh token available')

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })

    try {
      const response = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      })

      if (!response.ok) throw await this.createOAuthError(response, 'Token refresh failed')

      const data = (await response.json()) as TwitchTokenResponse
      this.tokenData = this.createTokenData(data)
      this.onTokenUpdated?.(this.tokenData)
      log('Token refresh successful')
      return this.tokenData
    } catch (error) {
      logError(`Token refresh failed: ${error instanceof Error ? error.message : error}`)
      throw error
    }
  }

  async getValidAccessToken(): Promise<string | null> {
    if (!this.tokenData) return null
    if (!this.needsRefresh()) return this.tokenData.accessToken

    try {
      const tokenData = await this.refreshAccessToken()
      return tokenData.accessToken
    } catch {
      return null
    }
  }

  getAccessToken(): string | null {
    if (!this.tokenData) return null
    if (this.needsRefresh()) return null
    return this.tokenData.accessToken
  }

  setTokenData(tokenData: TwitchTokenData): void {
    this.tokenData = {
      ...tokenData,
      scope: [...tokenData.scope]
    }
    log('Token data set from storage')
  }

  getTokenData(): TwitchTokenData | null {
    if (!this.tokenData) return null
    return {
      ...this.tokenData,
      scope: [...this.tokenData.scope]
    }
  }

  clearTokenData(): void {
    this.tokenData = null
    this.refreshPromise = null
    log('Token data cleared')
  }

  isAuthenticated(): boolean {
    return this.tokenData !== null && this.tokenData.refreshToken.length > 0
  }

  needsRefresh(): boolean {
    if (!this.tokenData) return false
    return Date.now() >= this.tokenData.expiresAt - REFRESH_BUFFER_MS
  }

  private createTokenData(data: TwitchTokenResponse): TwitchTokenData {
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      scope: data.scope
    }
  }

  private async createOAuthError(response: Response, fallback: string): Promise<Error> {
    let message = fallback

    try {
      const error = (await response.json()) as TwitchErrorResponse
      if (error.message) message = `${fallback}: ${error.message}`
    } catch {
      // Ignore invalid/non-JSON error responses.
    }

    return new Error(message)
  }
}
