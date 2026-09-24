import { TwitchOAuth } from './oauth.js'
import { TwitchClient } from './client.js'
import type { TwitchConnectionStatus, TwitchTokenData, TwitchUserInfo } from './types.js'
import { getSecrets, updateSecrets } from '../../secrets.js'

function log(message: string): void {
  console.log(`[TWITCH INTEGRATION] ${message}`)
}

function logError(message: string): void {
  console.error(`[TWITCH INTEGRATION] ${message}`)
}

let oauth: TwitchOAuth | null = null
let client: TwitchClient | null = null

export function initializeTwitchIntegration(config?: { clientId?: string; clientSecret?: string }): void {
  if (oauth) {
    log('Twitch integration already initialized')
    return
  }

  oauth = new TwitchOAuth(config)
  client = new TwitchClient(oauth)

  const secrets = getSecrets()
  if (secrets.twitchTokenData) {
    oauth.setTokenData(secrets.twitchTokenData)
    log('Restored Twitch token data from storage')
  }

  if (secrets.twitchUserInfo) {
    client.setCachedUserInfo(secrets.twitchUserInfo)
    log('Restored Twitch user info from storage')
  }

  log('Twitch integration initialized')
}

export function getConnectionStatus(): TwitchConnectionStatus {
  if (!oauth || !client) {
    return { connected: false, user: null, connectedAt: null }
  }

  if (!oauth.isAuthenticated()) {
    return { connected: false, user: null, connectedAt: null }
  }

  const secrets = getSecrets()
  return {
    connected: true,
    user: secrets.twitchUserInfo,
    connectedAt: secrets.twitchConnectedAt
  }
}

export function getAuthUrl(): string {
  if (!oauth) {
    throw new Error('Twitch integration not initialized')
  }

  return oauth.getAuthUrl()
}

export async function handleOAuthCallback(code: string): Promise<TwitchUserInfo> {
  if (!oauth || !client) {
    throw new Error('Twitch integration not initialized')
  }

  try {
    const tokenData = await oauth.exchangeCodeForToken(code)
    const userInfo = await client.getUserInfo()

    updateSecrets({
      twitchTokenData: tokenData,
      twitchUserInfo: userInfo,
      twitchConnectedAt: Date.now()
    })

    log(`Twitch account connected: ${userInfo.displayName}`)
    return userInfo
  } catch (error) {
    logError(`OAuth callback failed: ${error instanceof Error ? error.message : error}`)
    throw error
  }
}

export function disconnect(): void {
  if (!oauth || !client) {
    log('Twitch integration not initialized, nothing to disconnect')
    return
  }

  oauth.clearTokenData()
  client.clearUserInfo()

  updateSecrets({
    twitchTokenData: null,
    twitchUserInfo: null,
    twitchConnectedAt: null
  })

  log('Twitch account disconnected')
}

export async function refreshConnection(): Promise<TwitchUserInfo> {
  if (!oauth || !client) {
    throw new Error('Twitch integration not initialized')
  }

  try {
    if (oauth.needsRefresh()) {
      await oauth.refreshAccessToken()
      updateSecrets({ twitchTokenData: oauth.getTokenData() })
    }

    const userInfo = await client.getUserInfo()
    updateSecrets({ twitchUserInfo: userInfo })
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

// Export for testing purposes only
export function _resetIntegration(): void {
  oauth = null
  client = null
}
