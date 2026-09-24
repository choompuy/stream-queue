import { SECRETS_PATH, createFileStore } from './persist.js'
import type { TwitchTokenData, TwitchUserInfo } from './integrations/twitch/types.js'

export type Secrets = {
  youtubeApiKey: string
  twitchTokenData: TwitchTokenData | null
  twitchUserInfo: TwitchUserInfo | null
  twitchConnectedAt: number | null
}

const store = createFileStore<Secrets>(SECRETS_PATH)
let secrets: Secrets = store.load({
  youtubeApiKey: '',
  twitchTokenData: null,
  twitchUserInfo: null,
  twitchConnectedAt: null
})

export function getSecrets(): Secrets {
  return { ...secrets }
}

export function updateSecrets(updates: Partial<Secrets>): Secrets {
  const next = { ...secrets }

  if (typeof updates.youtubeApiKey === 'string' && updates.youtubeApiKey.trim() !== '') {
    next.youtubeApiKey = updates.youtubeApiKey.trim()
  }

  if (updates.twitchTokenData !== undefined) {
    next.twitchTokenData = updates.twitchTokenData
  }

  if (updates.twitchUserInfo !== undefined) {
    next.twitchUserInfo = updates.twitchUserInfo
  }

  if (updates.twitchConnectedAt !== undefined) {
    next.twitchConnectedAt = updates.twitchConnectedAt
  }

  secrets = next
  store.scheduleSave(
    () => secrets,
    (error) => console.error('[SECRETS] Failed to save:', error instanceof Error ? error.message : error)
  )

  return { ...secrets }
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
    twitchConnected: secrets.twitchTokenData !== null,
    twitchUser: secrets.twitchUserInfo
      ? {
          displayName: secrets.twitchUserInfo.displayName,
          login: secrets.twitchUserInfo.login
        }
      : null
  }
}
