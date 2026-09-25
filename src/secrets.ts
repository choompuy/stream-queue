import 'dotenv/config'
import { SECRETS_PATH, createFileStore } from './persist.js'
import type { TwitchSecrets } from './integrations/twitch/types.js'

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

export function updateTwitchOAuthState(updates: Partial<TwitchSecrets>): void {
  if (Object.keys(updates).length === 0) return

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
  const clientId = process.env.TWITCH_CLIENT_ID
  if (!clientId) throw new Error('Twitch Client ID is not configured')
  return clientId
}

export function getPublicSecretsView() {
  return {
    youtubeApiKey: maskSecret(secrets.youtubeApiKey),
    hasYoutubeApiKey: secrets.youtubeApiKey.length > 0,

    twitch: {
      configured: Boolean(getTwitchClientId()),
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
