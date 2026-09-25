import { TwitchOAuth } from './oauth.js'
import { TwitchClient } from './client.js'
import { TwitchEventSub } from './eventsub.js'
import type { TwitchAuthConfig, TwitchChannelPointsRedemption, TwitchConnectionStatus, TwitchUserInfo, TwitchDeviceCodeResponse } from './types.js'
import { clearTwitchOAuthState, getSecrets, updateTwitchOAuthState } from '../../secrets.js'
import { requestSong } from '../../queue.js'
import { getConfig } from '../../config.js'
import { AppError } from '../../types.js'

function log(message: string): void {
  console.log(`[TWITCH INTEGRATION] ${message}`)
}

function logError(message: string): void {
  console.error(`[TWITCH INTEGRATION] ${message}`)
}

const REDEMPTION_RETRY_ATTEMPTS = 3
const REDEMPTION_RETRY_DELAY_MS = 1000

let oauth: TwitchOAuth | null = null
let client: TwitchClient | null = null
let eventSub: TwitchEventSub | null = null
let deviceAuthorizationPromise: Promise<TwitchUserInfo> | null = null

export function initializeTwitchIntegration(config: Partial<TwitchAuthConfig> = {}): void {
  if (oauth) {
    log('Twitch integration already initialized')
    return
  }

  oauth = new TwitchOAuth({
    ...config,
    onTokenUpdated: (tokenData) => {
      updateTwitchOAuthState({ tokenData })
    }
  })
  client = new TwitchClient(oauth)

  const secrets = getSecrets()

  if (secrets.twitch.tokenData) {
    oauth.setTokenData(secrets.twitch.tokenData)
    log('Restored Twitch token data from storage')
  }

  if (secrets.twitch.userInfo) {
    client.setCachedUserInfo(secrets.twitch.userInfo)
    log('Restored Twitch user info from storage')
  }

  log('Twitch integration initialized')

  void startEventSub()
}

export async function reinitializeTwitchIntegration(): Promise<void> {
  if (eventSub) {
    await eventSub.disconnect()
    eventSub = null
  }

  oauth = null
  client = null
  deviceAuthorizationPromise = null
  initializeTwitchIntegration()
}

async function handleChannelPointsRedemption(event: TwitchChannelPointsRedemption): Promise<void> {
  log(`Channel Points redemption: ${event.reward.title} by ${event.user_name}`)

  const configuredRewardId = getConfig().twitch.channelPointsRewardId
  if (!configuredRewardId || event.reward.id !== configuredRewardId) return

  const query = event.user_input.trim()
  if (!query) {
    logError(`Empty song request in redemption: ${event.id}`)
    return
  }

  if (!client) {
    logError(`Twitch client is not initialized for redemption: ${event.id}`)
    return
  }

  const result = await requestSong(query, event.user_name, false)

  if (result.outcome !== 'added') {
    logError(`Song request failed for redemption ${event.id}: ${result.outcome}`)
    return
  }

  await fulfillRedemption(event, client)
}

async function startEventSub(): Promise<void> {
  if (!oauth || !client) return
  if (eventSub) return

  const userInfo = client.getCachedUserInfo()
  if (!userInfo) {
    log('Twitch account not connected, EventSub will not start')
    return
  }

  const clientId = oauth.getConfig().clientId
  if (!clientId) {
    log('Twitch client ID not configured, EventSub will not start')
    return
  }

  eventSub = new TwitchEventSub({
    clientId,
    oauth,
    broadcasterUserId: userInfo.id,
    onChannelPointsRedemption: handleChannelPointsRedemption
  })

  try {
    await eventSub.connect()
    log('Twitch EventSub connected')
  } catch (error) {
    eventSub = null
    logError(`Failed to start EventSub: ${error instanceof Error ? error.message : error}`)
  }
}

export function getConnectionStatus(): TwitchConnectionStatus {
  if (!oauth || !client) {
    return {
      connected: false,
      user: null,
      connectedAt: null
    }
  }

  const secrets = getSecrets()
  const tokenData = oauth.getTokenData()
  const userInfo = client.getCachedUserInfo()

  // Connection requires both token data AND user info
  if (!tokenData || !userInfo) {
    return {
      connected: false,
      user: null,
      connectedAt: null
    }
  }

  return {
    connected: true,
    user: userInfo,
    connectedAt: secrets.twitch.connectedAt
  }
}

export async function startDeviceAuthorization(): Promise<TwitchDeviceCodeResponse> {
  if (!oauth || !client) {
    throw new AppError('TWITCH_AUTH_ERROR', 'Twitch integration not initialized')
  }

  if (getConnectionStatus().connected) {
    throw new AppError('TWITCH_AUTH_ERROR', 'Twitch account is already connected')
  }

  if (deviceAuthorizationPromise) {
    throw new AppError('TWITCH_AUTH_ERROR', 'Twitch authorization is already in progress')
  }

  const device = await oauth.requestDeviceCode()

  deviceAuthorizationPromise = oauth
    .pollForToken(device.device_code, device.interval, device.expires_in)
    .then(async () => {
      if (!client) throw new AppError('TWITCH_AUTH_ERROR', 'Twitch client is not initialized')

      const userInfo = await client.getUserInfo()

      updateTwitchOAuthState({
        userInfo,
        connectedAt: Date.now()
      })

      await startEventSub()

      log(`Twitch account connected: ${userInfo.displayName}`)
      return userInfo
    })
    .catch((error) => {
      logError(`Device authorization failed: ${error instanceof Error ? error.message : error}`)
      throw error
    })
    .finally(() => {
      deviceAuthorizationPromise = null
    })

  return device
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fulfillRedemption(redemption: TwitchChannelPointsRedemption, twitchClient: TwitchClient): Promise<void> {
  for (let attempt = 1; attempt <= REDEMPTION_RETRY_ATTEMPTS; attempt++) {
    try {
      await twitchClient.updateRedemptionStatus(redemption, 'FULFILLED')
      log(`Channel Points redemption fulfilled: ${redemption.id}`)
      return
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)

      if (attempt === REDEMPTION_RETRY_ATTEMPTS) {
        logError(`Failed to fulfill redemption ${redemption.id} after ${attempt} attempts: ${reason}`)
        return
      }

      const delay = REDEMPTION_RETRY_DELAY_MS * 2 ** (attempt - 1)

      logError(`Failed to fulfill redemption ${redemption.id} (attempt ${attempt}/${REDEMPTION_RETRY_ATTEMPTS}): ${reason}. Retrying in ${delay}ms`)

      await wait(delay)
    }
  }
}

export function isDeviceAuthorizationPending(): boolean {
  return deviceAuthorizationPromise !== null
}

export async function disconnect(): Promise<void> {
  if (!oauth || !client) {
    log('Twitch integration not initialized, nothing to disconnect')
    return
  }

  if (eventSub) {
    await eventSub.disconnect()
    eventSub = null
  }

  oauth.clearTokenData()
  client.clearUserInfo()
  deviceAuthorizationPromise = null
  clearTwitchOAuthState()

  log('Twitch account disconnected')
}

export async function refreshConnection(): Promise<TwitchUserInfo> {
  if (!oauth || !client) throw new AppError('TWITCH_REFRESH_ERROR', 'Twitch integration not initialized')

  try {
    if (oauth.needsRefresh()) await oauth.refreshAccessToken()

    const userInfo = await client.getUserInfo()

    updateTwitchOAuthState({ userInfo })

    await startEventSub()

    log('Twitch connection refreshed')
    return userInfo
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    logError(`Failed to refresh connection: ${reason}`)
    throw new AppError('TWITCH_REFRESH_ERROR', reason)
  }
}

export function getClient(): TwitchClient | null {
  return client
}

export function getOAuth(): TwitchOAuth | null {
  return oauth
}

export function getEventSub(): TwitchEventSub | null {
  return eventSub
}

// Export for testing purposes only
export async function _resetIntegration(): Promise<void> {
  if (eventSub) await eventSub.disconnect()

  oauth = null
  client = null
  eventSub = null
  deviceAuthorizationPromise = null
}
