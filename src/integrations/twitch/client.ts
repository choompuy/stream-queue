import type {
  TwitchUserInfo,
  TwitchUsersResponse,
  TwitchErrorResponse,
  TwitchRedemptionStatus,
  TwitchChannelPointsRedemption,
  TwitchRedemptionsResponse,
  TwitchCustomReward,
  TwitchCustomRewardsResponse,
  TwitchRedemptionUpdateStatus
} from './types.js'
import { TwitchOAuth } from './oauth.js'
import { AppError } from '../../types.js'

function log(message: string): void {
  console.log(`[TWITCH CLIENT] ${message}`)
}

function logError(message: string): void {
  console.error(`[TWITCH CLIENT] ${message}`)
}

export class TwitchClient {
  private readonly oauth: TwitchOAuth
  private userInfo: TwitchUserInfo | null = null

  constructor(oauth: TwitchOAuth) {
    this.oauth = oauth
  }

  private async makeAuthenticatedRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
    const accessToken = await this.oauth.getValidAccessToken()
    if (!accessToken) throw new AppError('TWITCH_NOT_CONNECTED', 'Twitch account is not connected')

    const response = await this.request<T>(url, options, accessToken)
    if (response.status !== 401) return this.handleResponse<T>(response)

    try {
      const refreshedToken = await this.oauth.refreshAccessToken()
      const retryResponse = await this.request<T>(url, options, refreshedToken.accessToken)
      return this.handleResponse<T>(retryResponse)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      logError(`Authentication retry failed: ${reason}`)
      throw new AppError('TWITCH_REFRESH_ERROR', `Authentication failed - please reconnect your Twitch account (${reason})`)
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

  async updateRedemptionStatus(
    redemption: TwitchChannelPointsRedemption,
    status: TwitchRedemptionUpdateStatus
  ): Promise<TwitchChannelPointsRedemption> {
    const userInfo = this.userInfo
    if (!userInfo) throw new AppError('TWITCH_NOT_CONNECTED', 'Twitch account is not connected')

    const params = new URLSearchParams({
      broadcaster_id: userInfo.id,
      reward_id: redemption.reward.id,
      id: redemption.id
    })

    const response = await this.makeAuthenticatedRequest<TwitchRedemptionsResponse>(
      `https://api.twitch.tv/helix/channel_points/custom_rewards/redemptions?${params}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status })
      }
    )

    const updatedRedemption = response.data[0]
    if (!updatedRedemption) throw new Error('Twitch API returned no updated redemption')

    return updatedRedemption
  }

  async getCustomRewards(): Promise<TwitchCustomReward[]> {
    const userInfo = this.userInfo
    if (!userInfo) throw new AppError('TWITCH_NOT_CONNECTED', 'Twitch account is not connected')

    const params = new URLSearchParams({
      broadcaster_id: userInfo.id
    })

    const response = await this.makeAuthenticatedRequest<TwitchCustomRewardsResponse>(
      `https://api.twitch.tv/helix/channel_points/custom_rewards?${params}`
    )

    return response.data
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
