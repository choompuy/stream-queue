import { createLogger, describeError } from '../../logger.js'
import { fetchWithTimeout } from '../../web-fetch.js'
import { setTimeout as sleep } from 'node:timers/promises'
import { emit } from '../../state-events.js'
import { AppError } from '../../types.js'
import { normalizeTwitchError } from './error.js'
import type {
  TwitchAuthConfig,
  TwitchDeviceCodeResponse,
  TwitchErrorResponse,
  TwitchOAuthOptions,
  TwitchTokenData,
  TwitchTokenResponse
} from './types.js'

const DEFAULT_SCOPES = ['chat:read', 'chat:edit', 'channel:manage:redemptions']
const REFRESH_BUFFER_MS = 5 * 60 * 1000
const REQUEST_TIMEOUT_MS = 15_000

const log = createLogger('TWITCH OAUTH')

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token'
const REVOKE_URL = 'https://id.twitch.tv/oauth2/revoke'

function postForm(url: string, params: URLSearchParams): Promise<Response> {
  return fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    },
    REQUEST_TIMEOUT_MS
  )
}

async function oauthError(response: Response, fallback: string): Promise<AppError> {
  const body = (await response.json().catch(() => ({}))) as TwitchErrorResponse
  const message = body.message || fallback
  return new AppError('TWITCH_API_ERROR', message, { status: response.status })
}

export class TwitchOAuth {
  private config: TwitchAuthConfig
  private tokenData: TwitchTokenData | null = null
  private refreshPromise: Promise<TwitchTokenData> | null = null
  private authFailed = false
  private tokenGeneration = 0
  private onTokenUpdated?: (tokenData: TwitchTokenData) => void

  constructor(config: TwitchOAuthOptions) {
    if (!config.clientId) {
      throw new AppError('TWITCH_AUTH_ERROR', 'Twitch client ID not configured')
    }

    this.config = {
      clientId: config.clientId,
      scopes: config.scopes || DEFAULT_SCOPES
    }

    this.onTokenUpdated = config.onTokenUpdated
  }

  getConfig(): TwitchAuthConfig {
    return {
      ...this.config,
      scopes: [...this.config.scopes]
    }
  }

  async requestDeviceCode(): Promise<TwitchDeviceCodeResponse> {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      scopes: this.config.scopes.join(' ')
    })

    try {
      const response = await postForm('https://id.twitch.tv/oauth2/device', params)

      if (!response.ok) throw await oauthError(response, 'Device authorization failed')

      const data = (await response.json()) as TwitchDeviceCodeResponse
      log.info('Device code requested')
      return data
    } catch (error) {
      // the error is reported where it ends (the /connect answer carries it to the panel):
      // logging it here as well makes every failure appear twice
      throw normalizeTwitchError(error)
    }
  }

  // `isWanted` says whether the login is still wanted: a login that was replaced or cancelled stops polling at once, and
  // the tokens Twitch gave it in the meantime are revoked instead of replacing those of the account that is connected
  async pollForToken(deviceCode: string, interval: number, expiresIn: number, isWanted: () => boolean = () => true): Promise<TwitchTokenData> {
    if (!deviceCode) throw new AppError('TWITCH_AUTH_ERROR', 'Twitch device code is required')

    const deadline = Date.now() + expiresIn * 1000
    let pollInterval = interval * 1000
    const currentGeneration = this.tokenGeneration

    while (Date.now() < deadline) {
      await sleep(pollInterval)
      if (!isWanted()) throw new AppError('TWITCH_AUTH_ERROR', 'Device authorization was cancelled')

      const params = new URLSearchParams({
        client_id: this.config.clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      })

      let response: Response
      try {
        response = await postForm(TOKEN_URL, params)
      } catch (error) {
        // a dropped connection or a timeout while the user is still entering the code must not end the authorization
        log.warn(`Device authorization poll failed, will retry: ${describeError(error)}`)
        continue
      }

      if (response.ok) {
        const data = (await response.json()) as TwitchTokenResponse

        if (!isWanted()) {
          // the code was entered after all, but nobody waits for it any more: the account must not change
          await this.revoke([data.access_token, data.refresh_token])
          throw new AppError('TWITCH_AUTH_ERROR', 'Device authorization was cancelled')
        }

        const tokenData = this.store(data, currentGeneration)

        log.info('Device authorization successful')
        return tokenData
      }

      const error = (await response.json().catch(() => ({}))) as TwitchErrorResponse
      if (error.message === 'authorization_pending') continue

      if (error.message === 'slow_down') {
        pollInterval += 5000
        continue
      }

      if (error.message === 'access_denied') throw new AppError('TWITCH_AUTH_ERROR', 'Twitch authorization was denied')
      if (error.message === 'expired_token') throw new AppError('TWITCH_AUTH_ERROR', 'Twitch device code expired')
      throw new AppError('TWITCH_AUTH_ERROR', error.message || 'Device authorization failed')
    }

    throw new AppError('TWITCH_AUTH_ERROR', 'Twitch device code expired')
  }

  async refreshAccessToken(): Promise<TwitchTokenData> {
    if (this.refreshPromise) return this.refreshPromise
    if (this.authFailed) throw new AppError('TWITCH_REFRESH_ERROR', 'Twitch no longer accepts the saved login, connect the account again')
    if (!this.tokenData?.refreshToken) throw new AppError('TWITCH_REFRESH_ERROR', 'No refresh token available')

    const currentGeneration = this.tokenGeneration
    this.refreshPromise = this.performRefresh(currentGeneration)

    try {
      return await this.refreshPromise
    } finally {
      this.refreshPromise = null
    }
  }

  async getValidAccessToken(): Promise<string | null> {
    if (!this.tokenData) return null
    if (!this.needsRefresh()) return this.tokenData.accessToken

    try {
      const tokenData = await this.refreshAccessToken()
      return tokenData.accessToken
    } catch (error) {
      log.error(`Failed to get valid access token: ${describeError(error)}`)
      return null
    }
  }

  setTokenData(tokenData: TwitchTokenData): void {
    this.tokenData = {
      ...tokenData,
      scope: [...tokenData.scope]
    }

    log.info('Token data set from storage')
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
    this.tokenGeneration++
    this.setAuthFailed(false)
    log.info('Token data cleared')
  }

  // Tells Twitch to forget the tokens (best effort: the account is disconnected locally whatever the answer)
  async revokeTokens(): Promise<void> {
    await this.revoke([this.tokenData?.accessToken, this.tokenData?.refreshToken])
  }

  private async revoke(candidates: (string | undefined)[]): Promise<void> {
    const { clientId } = this.config
    const tokens = candidates.filter((token): token is string => Boolean(token))
    if (!clientId || tokens.length === 0) return

    await Promise.all(
      tokens.map(async (token) => {
        try {
          const response = await postForm(REVOKE_URL, new URLSearchParams({ client_id: clientId, token }))
          if (!response.ok) log.warn(`Token revoke was refused with ${response.status}`)
        } catch (error) {
          log.warn(`Token revoke failed: ${describeError(error)}`)
        }
      })
    )
  }

  // True once Twitch has refused the refresh token: the account has to be connected again
  private setAuthFailed(failed: boolean): void {
    if (this.authFailed === failed) return

    this.authFailed = failed
    emit('twitch')
  }

  private isCurrent(generation: number): boolean {
    return generation === this.tokenGeneration
  }

  needsReauthorization(): boolean {
    return this.authFailed
  }

  isAuthenticated(): boolean {
    // Twitch refresh tokens have no locally known expiration time
    // A revoked or invalid refresh token is detected only when Twitch rejects a refresh request
    return this.tokenData !== null && this.tokenData.refreshToken.length > 0
  }

  needsRefresh(): boolean {
    if (!this.tokenData) return false

    return Date.now() >= this.tokenData.expiresAt - REFRESH_BUFFER_MS
  }

  private async performRefresh(expectedGeneration: number): Promise<TwitchTokenData> {
    const refreshToken = this.tokenData?.refreshToken
    if (!refreshToken) throw new AppError('TWITCH_REFRESH_ERROR', 'No refresh token available')

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })

    try {
      const response = await postForm(TOKEN_URL, params)

      if (!response.ok) {
        // Twitch refused the refresh token itself (expired after 30 days of a public client, revoked, password
        // changed): retrying is pointless, the account has to be connected again. A network error or a 5xx is not
        // that, and is reported as the API error it is
        if (response.status === 400 || response.status === 401) {
          this.setAuthFailed(true)
          const body = (await response.json().catch(() => ({}))) as TwitchErrorResponse
          throw new AppError('TWITCH_REFRESH_ERROR', body.message || 'Token refresh failed')
        }
        throw await oauthError(response, 'Token refresh failed')
      }

      const data = (await response.json()) as TwitchTokenResponse

      // the account can be disconnected while the request is on its way: the tokens Twitch issued are
      // revoked instead of replacing whoever connected in the meantime (the same thing pollForToken does)
      if (!this.isCurrent(expectedGeneration)) {
        await this.revoke([data.access_token, data.refresh_token])
        throw new AppError('TWITCH_REFRESH_ERROR', 'Login was cancelled during token refresh')
      }

      const tokenData = this.store(data, expectedGeneration)
      log.info('Token refresh successful')
      return tokenData
    } catch (error) {
      if (error instanceof AppError) {
        // a refresh dropped because the account was disconnected meanwhile is an orderly exit, not a failure
        if (this.isCurrent(expectedGeneration)) log.error(describeError(error))
        else log.info('Token refresh dropped: the account was disconnected meanwhile')
        throw error
      }
      // Network errors become TWITCH_REFRESH_ERROR
      log.error(describeError(error))
      throw new AppError('TWITCH_REFRESH_ERROR', `Token refresh failed: ${describeError(error)}`)
    }
  }

  private store(data: TwitchTokenResponse, expectedGeneration: number): TwitchTokenData {
    // a second guard: the refresh answers one at a time, but a device login may have won the race
    if (!this.isCurrent(expectedGeneration)) {
      throw new AppError('TWITCH_REFRESH_ERROR', 'Login was cancelled during token refresh')
    }

    this.tokenData = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      scope: data.scope
    }
    this.setAuthFailed(false)
    this.onTokenUpdated?.(this.tokenData)

    return this.tokenData
  }
}
