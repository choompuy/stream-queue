import type { TwitchUserInfo, TwitchUsersResponse, TwitchErrorResponse } from './types.js'
import { TwitchOAuth } from './oauth.js'

function log(message: string): void {
  console.log(`[TWITCH CLIENT] ${message}`)
}

function logError(message: string): void {
  console.error(`[TWITCH CLIENT] ${message}`)
}

export class TwitchClient {
  private oauth: TwitchOAuth
  private userInfo: TwitchUserInfo | null = null

  constructor(oauth: TwitchOAuth) {
    this.oauth = oauth
  }

  private async makeAuthenticatedRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
    const accessToken = await this.oauth.getValidAccessToken()
    if (!accessToken) throw new Error('Not authenticated with Twitch')

    const response = await this.request<T>(url, options, accessToken)
    if (response.status !== 401) return this.handleResponse<T>(response)

    try {
      const refreshedToken = await this.oauth.refreshAccessToken()
      const retryResponse = await this.request<T>(url, options, refreshedToken.accessToken)
      return this.handleResponse<T>(retryResponse)
    } catch (error) {
      logError(`Authentication retry failed: ${error instanceof Error ? error.message : error}`)
      throw new Error('Authentication failed - please reconnect your Twitch account')
    }
  }

  private async request<T>(url: string, options: RequestInit, accessToken: string): Promise<Response> {
    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${accessToken}`,
        'Client-Id': this.oauth.getConfig().clientId
      }
    })
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (response.ok) return response.json() as Promise<T>

    let message = `HTTP ${response.status}`

    try {
      const error = (await response.json()) as TwitchErrorResponse

      if (error.message) message = error.message
    } catch {
      // Ignore invalid/non-JSON responses.
    }

    throw new Error(`Twitch API error: ${message}`)
  }

  async getUserInfo(): Promise<TwitchUserInfo> {
    try {
      const response = await this.makeAuthenticatedRequest<TwitchUsersResponse>('https://api.twitch.tv/helix/users')
      if (!response.data?.length) throw new Error('No user data returned from Twitch API')

      const userData = response.data[0]
      this.userInfo = {
        id: userData.id,
        login: userData.login,
        displayName: userData.display_name,
        profileImageUrl: userData.profile_image_url
      }

      log(`Retrieved user info for: ${this.userInfo.displayName}`)
      return this.userInfo
    } catch (error) {
      logError(`Failed to get user info: ${error instanceof Error ? error.message : error}`)
      throw error
    }
  }

  getCachedUserInfo(): TwitchUserInfo | null {
    return this.userInfo
  }

  setCachedUserInfo(userInfo: TwitchUserInfo | null): void {
    this.userInfo = userInfo
  }

  clearUserInfo(): void {
    this.userInfo = null
  }
}
