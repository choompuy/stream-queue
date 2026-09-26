import 'dotenv/config'
import { SECRETS_PATH, createFileStore } from './persist.js'
import type { TwitchSecrets, TwitchTokenData, TwitchUserInfo } from './integrations/twitch/types.js'

export type Secrets = {
  youtubeApiKey: string
  twitch: TwitchSecrets
}

export type SecretsUpdates = {
  youtubeApiKey?: string
}

const store = createFileStore<Secrets>(SECRETS_PATH)

let secrets: Secrets = store.load({
  youtubeApiKey: '',
  twitch: {
    tokenData: null,
    userInfo: null,
    connectedAt: null
  }
})

export function getSecrets(): Secrets {
  return structuredClone(secrets)
}

export function updateSecrets(updates: SecretsUpdates): Secrets {
  let changed = false

  if (updates.youtubeApiKey !== undefined) {
    if (typeof updates.youtubeApiKey !== 'string') {
      throw new Error('youtubeApiKey must be a string')
    }

    const value = updates.youtubeApiKey.trim()
    // Allow empty string to clear the key
    if (value !== secrets.youtubeApiKey) {
      secrets = {
        ...secrets,
        youtubeApiKey: value
      }
      changed = true
    }
  }

  if (changed) scheduleSave()
  return getSecrets()
}

function isValidTokenData(value: unknown): value is TwitchTokenData {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>

  return (
    typeof v.accessToken === 'string' &&
    typeof v.refreshToken === 'string' &&
    typeof v.expiresAt === 'number' &&
    Array.isArray(v.scope) &&
    v.scope.every((s) => typeof s === 'string')
  )
}

function isValidUserInfo(value: unknown): value is TwitchUserInfo {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>

  return typeof v.id === 'string' && typeof v.login === 'string' && typeof v.displayName === 'string' && typeof v.profileImageUrl === 'string'
}

export function updateTwitchOAuthState(updates: Partial<TwitchSecrets>): void {
  if (Object.keys(updates).length === 0) return

  if ('tokenData' in updates && updates.tokenData !== null && !isValidTokenData(updates.tokenData)) {
    throw new Error('tokenData must be a valid TwitchTokenData object or null')
  }

  if ('userInfo' in updates && updates.userInfo !== null && !isValidUserInfo(updates.userInfo)) {
    throw new Error('userInfo must be a valid TwitchUserInfo object or null')
  }

  if ('connectedAt' in updates && updates.connectedAt !== null && typeof updates.connectedAt !== 'number') {
    throw new Error('connectedAt must be a number or null')
  }

  secrets = {
    ...secrets,
    twitch: {
      ...secrets.twitch,
      ...updates
    }
  }

  scheduleSave()
}

export function clearTwitchOAuthState(): void {
  const { tokenData, userInfo, connectedAt } = secrets.twitch
  if (tokenData === null && userInfo === null && connectedAt === null) return

  updateTwitchOAuthState({
    tokenData: null,
    userInfo: null,
    connectedAt: null
  })
}

function maskSecret(value: string): string {
  if (!value) return ''
  if (value.length <= 8) return '•'.repeat(value.length)
  return `${value.slice(0, 4)}${'•'.repeat(value.length - 8)}${value.slice(-4)}`
}

export function getTwitchClientId(): string {
  return process.env.TWITCH_CLIENT_ID?.trim() || ''
}

export function getPublicSecretsView() {
  const twitchClientId = getTwitchClientId()
  return {
    youtubeApiKey: maskSecret(secrets.youtubeApiKey),
    hasYoutubeApiKey: secrets.youtubeApiKey.length > 0,

    twitch: {
      configured: Boolean(twitchClientId),
      connected: secrets.twitch.tokenData !== null && secrets.twitch.userInfo !== null,
      user: secrets.twitch.userInfo
        ? {
            displayName: secrets.twitch.userInfo.displayName,
            login: secrets.twitch.userInfo.login
          }
        : null,
      connectedAt: secrets.twitch.connectedAt
    }
  }
}

function scheduleSave(): void {
  store.scheduleSave(
    () => secrets,
    (error) => {
      console.error('[SECRETS] Failed to save:', error instanceof Error ? error.message : error)
    }
  )
}

export type SecretsResponse = ReturnType<typeof getPublicSecretsView>
