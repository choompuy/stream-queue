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
    let accessToken = this.oauth.getAccessToken()

    // Try to refresh if needed
    if (!accessToken && this.oauth.needsRefresh()) {
      try {
        await this.oauth.refreshAccessToken()
        accessToken = this.oauth.getAccessToken()
      } catch (error) {
        logError(`Failed to refresh token for request: ${error instanceof Error ? error.message : error}`)
        throw new Error('Authentication failed - please reconnect your Twitch account')
      }
    }

    if (!accessToken) {
      throw new Error('Not authenticated with Twitch')
    }

    const response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${accessToken}`,
        'Client-Id': this.oauth.getConfig().clientId
      }
    })

    if (!response.ok) {
      const error = (await response.json()) as TwitchErrorResponse
      throw new Error(`Twitch API error: ${error.message} (${error.status})`)
    }

    return response.json() as Promise<T>
  }

  async getUserInfo(): Promise<TwitchUserInfo> {
    try {
      const response = await this.makeAuthenticatedRequest<TwitchUsersResponse>(
        'https://api.twitch.tv/helix/users'
      )

      if (!response.data || response.data.length === 0) {
        throw new Error('No user data returned from Twitch API')
      }

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