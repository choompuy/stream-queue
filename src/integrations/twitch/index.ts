import { TwitchOAuth } from './oauth.js'
import { TwitchClient } from './client.js'
import { TwitchEventSub } from './eventsub.js'
import type { TwitchAuthConfig, TwitchChannelPointsRedemption, TwitchConnectionStatus, TwitchUserInfo } from './types.js'
import { getSecrets, updateSecrets } from '../../secrets.js'

function log(message: string): void {
  console.log(`[TWITCH INTEGRATION] ${message}`)
}

function logError(message: string): void {
  console.error(`[TWITCH INTEGRATION] ${message}`)
}

let oauth: TwitchOAuth | null = null
let client: TwitchClient | null = null
let eventSub: TwitchEventSub | null = null

export function initializeTwitchIntegration(config: Partial<TwitchAuthConfig> = {}): void {
  if (oauth) {
    log('Twitch integration already initialized')
    return
  }

  oauth = new TwitchOAuth({
    ...config,
    onTokenUpdated: (tokenData) => {
      updateSecrets({
        twitch: {
          tokenData
        }
      })
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

async function handleChannelPointsRedemption(event: TwitchChannelPointsRedemption): Promise<void> {
  log(`Channel Points redemption: ${event.reward.title} by ${event.user_name}`)
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

  if (!tokenData?.refreshToken || !userInfo) {
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

export function getAuthUrl(state: string): string {
  if (!oauth) throw new Error('Twitch integration not initialized')
  return oauth.getAuthUrl(state)
}

export async function handleOAuthCallback(code: string): Promise<TwitchUserInfo> {
  if (!oauth || !client) throw new Error('Twitch integration not initialized')

  try {
    await oauth.exchangeCodeForToken(code)
    const userInfo = await client.getUserInfo()
    updateSecrets({
      twitch: {
        userInfo,
        connectedAt: Date.now()
      }
    })
    await startEventSub()
    log(`Twitch account connected: ${userInfo.displayName}`)
    return userInfo
  } catch (error) {
    logError(`OAuth callback failed: ${error instanceof Error ? error.message : error}`)
    throw error
  }
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
  updateSecrets({
    twitch: {
      tokenData: null,
      userInfo: null,
      connectedAt: null
    }
  })
  log('Twitch account disconnected')
}

export async function refreshConnection(): Promise<TwitchUserInfo> {
  if (!oauth || !client) throw new Error('Twitch integration not initialized')

  try {
    if (oauth.needsRefresh()) await oauth.refreshAccessToken()

    const userInfo = await client.getUserInfo()
    updateSecrets({
      twitch: {
        userInfo
      }
    })
    log('Twitch connection refreshed')
    return userInfo
  } catch (error) {
    logError(`Failed to refresh connection: ${error instanceof Error ? error.message : error}`)
    throw error
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
export function _resetIntegration(): void {
  oauth = null
  client = null
}
