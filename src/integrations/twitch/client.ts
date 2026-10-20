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
import { createLogger, describeError } from '../../logger.js'
import { markTransient, normalizeTwitchError } from './error.js'
import { fetchWithTimeout } from '../../web-fetch.js'

const log = createLogger('TWITCH CLIENT')

const REQUEST_TIMEOUT_MS = 15_000
const REWARDS_URL = 'https://api.twitch.tv/helix/channel_points/custom_rewards'

// StreamQueue's own reward always takes the viewer's input: the flag lives once, not in each method that writes it
const REWARD_REQUIRES_INPUT = true

export const CHANNEL_POINTS_REDEMPTION = 'channel.channel_points_custom_reward_redemption.add'

export class TwitchClient {
  private readonly oauth: TwitchOAuth
  private userInfo: TwitchUserInfo | null = null

  constructor(oauth: TwitchOAuth) {
    this.oauth = oauth
  }

  private async makeAuthenticatedRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
    const accessToken = await this.oauth.getValidAccessToken()
    if (!accessToken) {
      const notConnected = new AppError('TWITCH_NOT_CONNECTED')
      // a login exists and Twitch has not refused it: a failed refresh was a passing problem, the request may work later
      throw this.refreshMayWorkLater() ? markTransient(notConnected) : notConnected
    }

    const response = await this.request(url, options, accessToken)

    // Only a 401 means the token is expired. A 403 is a refusal that a new token does not change (a reward made by
    // another app, a missing scope), so it is reported as it is, without a pointless refresh
    if (response.status !== 401) return this.handleResponse<T>(response)

    // the refused body is never read on this path: drain it, so the connection is not held until it times out
    await response.body?.cancel().catch(() => {})

    let refreshedToken: Awaited<ReturnType<TwitchOAuth['refreshAccessToken']>>
    try {
      refreshedToken = await this.oauth.refreshAccessToken()
    } catch (error) {
      const normalized = normalizeTwitchError(error)
      log.error(`Token refresh failed: ${describeError(normalized)}`)
      // a login exists and Twitch has not refused it: the refresh failure was passing, a retry is worth it
      // (an error that already carries the flag keeps it, whatever the login looks like)
      throw this.refreshMayWorkLater() ? markTransient(normalized) : normalized
    }

    // an error of the retried request itself is its own error, not a failed login
    return this.handleResponse<T>(await this.request(url, options, refreshedToken.accessToken))
  }

  private async request(url: string, options: RequestInit, accessToken: string): Promise<Response> {
    // headers arrive as a plain object, a Headers or an array of pairs: a spread would silently lose the
    // non-plain forms, so they merge instead
    const headers = new Headers(options.headers)
    headers.set('Authorization', `Bearer ${accessToken}`)
    headers.set('Client-Id', this.oauth.getConfig().clientId)

    try {
      return await fetchWithTimeout(url, { ...options, headers }, REQUEST_TIMEOUT_MS)
    } catch (error) {
      throw normalizeTwitchError(error)
    }
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

    throw new AppError('TWITCH_API_ERROR', message, { status: response.status })
  }

  // a login exists and Twitch has not refused it: a failed refresh was a passing problem
  private refreshMayWorkLater(): boolean {
    return Boolean(this.oauth.getTokenData()?.refreshToken) && !this.oauth.needsReauthorization()
  }

  needsReauthorization(): boolean {
    return this.oauth.needsReauthorization()
  }

  private get broadcasterId(): string {
    if (!this.userInfo) throw new AppError('TWITCH_NOT_CONNECTED')
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

    log.info(`Retrieved user info for: ${this.userInfo.displayName}`)
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

    return this.sendForOne(`${REWARDS_URL}?${params}`, 'POST', { ...data, is_user_input_required: REWARD_REQUIRES_INPUT }, 'Twitch API returned no created reward')
  }

  async updateCustomReward(rewardId: string, data: TwitchUpdateCustomReward): Promise<TwitchCustomReward> {
    const params = new URLSearchParams({ broadcaster_id: this.broadcasterId, id: rewardId })

    return this.sendForOne(`${REWARDS_URL}?${params}`, 'PATCH', { ...data, is_user_input_required: REWARD_REQUIRES_INPUT }, 'Twitch API returned no updated reward')
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
