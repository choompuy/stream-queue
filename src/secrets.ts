import { SECRETS_PATH, createFileStore } from './persist.js'
import type { TwitchSecrets, TwitchSecretsUpdates } from './integrations/twitch/types.js'

export type Secrets = {
  youtubeApiKey: string
  twitch: TwitchSecrets
}

export type SecretsUpdates = {
  youtubeApiKey?: string
  twitch?: TwitchSecretsUpdates
}

const store = createFileStore<Secrets>(SECRETS_PATH)
let secrets: Secrets = store.load({
  youtubeApiKey: '',
  twitch: {
    clientId: null,
    clientSecret: null,
    tokenData: null,
    userInfo: null,
    connectedAt: null
  }
})

export function getSecrets(): Secrets {
  return {
    ...secrets,
    twitch: {
      ...secrets.twitch
    }
  }
}

export function updateSecrets(updates: SecretsUpdates): Secrets {
  if (updates.youtubeApiKey !== undefined && updates.youtubeApiKey.trim() !== '') {
    secrets.youtubeApiKey = updates.youtubeApiKey.trim()
  }

  if (updates.twitch) {
    Object.assign(secrets.twitch, updates.twitch)
  }

  store.scheduleSave(
    () => secrets,
    (error) => console.error('[SECRETS] Failed to save:', error instanceof Error ? error.message : error)
  )
  
  return getSecrets()
}

function maskSecret(value: string): string {
  if (!value) return ''
  if (value.length <= 8) return '•'.repeat(value.length)
  return `${value.slice(0, 4)}${'•'.repeat(value.length - 8)}${value.slice(-4)}`
}

export function getPublicSecretsView() {
  return {
    youtubeApiKey: maskSecret(secrets.youtubeApiKey),
    hasYoutubeApiKey: secrets.youtubeApiKey.length > 0,

    twitch: {
      configured: Boolean(secrets.twitch.clientId) && Boolean(secrets.twitch.clientSecret),
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
