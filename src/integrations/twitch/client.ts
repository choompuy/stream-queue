import type {
  TwitchUserInfo,
  TwitchUsersResponse,
  TwitchErrorResponse,
  TwitchChannelPointsRedemption,
  TwitchCustomReward,
  TwitchCustomRewardsResponse,
  TwitchRedemptionUpdateStatus,
  TwitchCreateCustomReward,
  TwitchUpdateCustomReward
} from './types.js'
import { TwitchOAuth } from './oauth.js'
import { AppError } from '../../types.js'
import { createLogger } from '../../logger.js'

const log = createLogger('TWITCH CLIENT')

const REQUEST_TIMEOUT_MS = 15_000
const REWARDS_URL = 'https://api.twitch.tv/helix/channel_points/custom_rewards'

export const CHANNEL_POINTS_REDEMPTION = 'channel.channel_points_custom_reward_redemption.add'

export class TwitchClient {
  private readonly oauth: TwitchOAuth
  private userInfo: TwitchUserInfo | null = null

  constructor(oauth: TwitchOAuth) {
    this.oauth = oauth
  }

  private async makeAuthenticatedRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
    if (!this.oauth.getConfig().clientId) throw new AppError('TWITCH_AUTH_ERROR', 'Twitch client ID not configured')

    const accessToken = await this.oauth.getValidAccessToken()
    if (!accessToken) {
      throw new AppError('TWITCH_NOT_CONNECTED', 'Twitch account is not connected', this.refreshMayWorkLater() ? { transient: 1 } : undefined)
    }

    const response = await this.request(url, options, accessToken)

    // Only a 401 means the token is expired. A 403 is a refusal that a new token does not change (a reward made by
    // another app, a missing scope), so it is reported as it is, without a pointless refresh
    if (response.status !== 401) return this.handleResponse<T>(response)

    let refreshedToken: Awaited<ReturnType<TwitchOAuth['refreshAccessToken']>>
    try {
      refreshedToken = await this.oauth.refreshAccessToken()
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      log.error(`Token refresh failed: ${reason}`)
      throw new AppError(
        'TWITCH_REFRESH_ERROR',
        `Authentication failed - please reconnect your Twitch account (${reason})`,
        this.refreshMayWorkLater() ? { transient: 1 } : undefined
      )
    }

    // an error of the retried request itself is its own error, not a failed login
    return this.handleResponse<T>(await this.request(url, options, refreshedToken.accessToken))
  }

  private async request(url: string, options: RequestInit, accessToken: string): Promise<Response> {
    return fetch(url, {
      ...options,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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

    throw new AppError('TWITCH_API_ERROR', `Twitch API error: ${message}`, { status: response.status })
  }

  // a login exists and Twitch has not refused it: a failed refresh was a passing problem
  private refreshMayWorkLater(): boolean {
    return Boolean(this.oauth.getTokenData()?.refreshToken) && !this.oauth.needsReauthorization()
  }

  needsReauthorization(): boolean {
    return this.oauth.needsReauthorization()
  }

  private get broadcasterId(): string {
    if (!this.userInfo) throw new AppError('TWITCH_NOT_CONNECTED', 'Twitch account is not connected')
    return this.userInfo.id
  }

  // POST / PATCH to an endpoint that answers with { data: [item] }
  private async sendForOne<T>(url: string, method: 'POST' | 'PATCH', body: unknown, emptyMessage: string): Promise<T> {
    const response = await this.makeAuthenticatedRequest<{ data: T[] }>(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })

    const first = response.data[0]
    if (!first) throw new AppError('TWITCH_API_ERROR', emptyMessage)

    return first
  }

  async getUserInfo(): Promise<TwitchUserInfo> {
    const response = await this.makeAuthenticatedRequest<TwitchUsersResponse>('https://api.twitch.tv/helix/users')
    if (!response.data?.length) throw new AppError('TWITCH_API_ERROR', 'No user data returned from Twitch API')

    const userData = response.data[0]
    this.userInfo = {
      id: userData.id,
      login: userData.login,
      displayName: userData.display_name,
      profileImageUrl: userData.profile_image_url
    }

    log.log(`Retrieved user info for: ${this.userInfo.displayName}`)
    return this.userInfo
  }

  async updateRedemptionStatus(redemption: { id: string; rewardId: string }, status: TwitchRedemptionUpdateStatus): Promise<TwitchChannelPointsRedemption> {
    const params = new URLSearchParams({
      broadcaster_id: this.broadcasterId,
      reward_id: redemption.rewardId,
      id: redemption.id
    })

    return this.sendForOne(
      `https://api.twitch.tv/helix/channel_points/custom_rewards/redemptions?${params}`,
      'PATCH',
      { status },
      'Twitch API returned no updated redemption'
    )
  }

  async getCustomRewards(onlyManageable: boolean = true): Promise<TwitchCustomReward[]> {
    const params = new URLSearchParams({ broadcaster_id: this.broadcasterId })
    if (onlyManageable) params.append('only_manageable_rewards', 'true')

    const response = await this.makeAuthenticatedRequest<TwitchCustomRewardsResponse>(`${REWARDS_URL}?${params}`)
    return response.data
  }

  async createCustomReward(data: TwitchCreateCustomReward): Promise<TwitchCustomReward> {
    const params = new URLSearchParams({ broadcaster_id: this.broadcasterId })

    return this.sendForOne(`${REWARDS_URL}?${params}`, 'POST', { ...data, is_user_input_required: true }, 'Twitch API returned no created reward')
  }

  async updateCustomReward(rewardId: string, data: TwitchUpdateCustomReward): Promise<TwitchCustomReward> {
    const params = new URLSearchParams({ broadcaster_id: this.broadcasterId, id: rewardId })

    return this.sendForOne(`${REWARDS_URL}?${params}`, 'PATCH', { ...data, is_user_input_required: true }, 'Twitch API returned no updated reward')
  }

  // Subscribes a live EventSub WebSocket session to Channel Points redemptions of the connected channel
  async subscribeToRedemptions(sessionId: string): Promise<void> {
    await this.makeAuthenticatedRequest('https://api.twitch.tv/helix/eventsub/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: CHANNEL_POINTS_REDEMPTION,
        version: '1',
        condition: { broadcaster_user_id: this.broadcasterId },
        transport: { method: 'websocket', session_id: sessionId }
      })
    })
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
