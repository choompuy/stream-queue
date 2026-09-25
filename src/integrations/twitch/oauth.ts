import type {
  TwitchTokenData,
  TwitchAuthConfig,
  TwitchTokenResponse,
  TwitchErrorResponse,
  TwitchOAuthOptions,
  TwitchDeviceCodeResponse
} from './types.js'

const DEFAULT_SCOPES = ['chat:read', 'chat:edit', 'channel:manage:redemptions']
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

  async requestDeviceCode(): Promise<TwitchDeviceCodeResponse> {
    if (!this.config.clientId) throw new Error('Twitch client ID not configured')

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      scopes: this.config.scopes.join(' ')
    })

    try {
      const response = await fetch('https://id.twitch.tv/oauth2/device', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      })

      if (!response.ok) throw await this.createOAuthError(response, 'Device authorization failed')

      const data = (await response.json()) as TwitchDeviceCodeResponse
      log('Device code requested')
      return data
    } catch (error) {
      logError(`Device code request failed: ${error instanceof Error ? error.message : error}`)
      throw error
    }
  }

  async pollForToken(deviceCode: string, interval: number, expiresIn: number): Promise<TwitchTokenData> {
    if (!deviceCode) throw new Error('Device code is required')
    if (!this.config.clientId) throw new Error('Twitch client ID not configured')

    const deadline = Date.now() + expiresIn * 1000
    let pollInterval = interval * 1000

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval))
      const params = new URLSearchParams({
        client_id: this.config.clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      })

      const response = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      })

      if (response.ok) {
        const data = (await response.json()) as TwitchTokenResponse
        this.tokenData = this.createTokenData(data)
        this.onTokenUpdated?.(this.tokenData)

        log('Device authorization successful')
        return this.tokenData
      }

      const error = (await response.json()) as TwitchErrorResponse
      if (error.message === 'authorization_pending') continue

      if (error.message === 'slow_down') {
        pollInterval += 5000
        continue
      }

      if (error.message === 'access_denied') throw new Error('Twitch authorization was denied')
      if (error.message === 'expired_token') throw new Error('Twitch device code expired')

      throw new Error(error.message || 'Device authorization failed')
    }

    throw new Error('Twitch device code expired')
  }

  async refreshAccessToken(): Promise<TwitchTokenData> {
    if (this.refreshPromise) return this.refreshPromise
    if (!this.tokenData?.refreshToken) throw new Error('No refresh token available')
    if (!this.config.clientId) throw new Error('Twitch client ID not configured')

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

  private async parseOAuthError(response: Response): Promise<{ code: string; message: string }> {
    try {
      const error = (await response.json()) as TwitchErrorResponse & { error?: string }
      return {
        code: error.error || '',
        message: error.message || `OAuth request failed with HTTP ${response.status}`
      }
    } catch {
      return {
        code: '',
        message: `OAuth request failed with HTTP ${response.status}`
      }
    }
  }

  private async createOAuthError(response: Response, fallback: string): Promise<Error> {
    const error = await this.parseOAuthError(response)
    return new Error(error.message ? `${fallback}: ${error.message}` : fallback)
  }
}
