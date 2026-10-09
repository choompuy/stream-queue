import { dataPath, type DeepPartial } from './persist.js'
import { createConfigModule, field, type FieldRule, type Schema } from './config-helper.js'
import { emit } from './state-events.js'
import { AppError, type TwitchSecrets, type TwitchTokenData, type TwitchUserInfo } from './types.js'

export type Secrets = {
  youtubeApiKey: string
  twitch: TwitchSecrets
}

export type SecretsUpdates = {
  youtubeApiKey?: string
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

const nullable = (isValid: (value: unknown) => boolean): FieldRule => field({ validate: (v) => v === null || isValid(v) })

const TWITCH_SCHEMA: Schema = {
  tokenData: nullable(isValidTokenData),
  userInfo: nullable(isValidUserInfo),
  connectedAt: nullable((v) => typeof v === 'number' && Number.isFinite(v))
}

const secrets = createConfigModule<Secrets>({
  filePath: () => dataPath('secrets.json'),
  defaults: { youtubeApiKey: '', twitch: { tokenData: null, userInfo: null, connectedAt: null } },
  schema: {
    // An empty string is allowed: it clears the key
    youtubeApiKey: field({ normalize: (v) => (typeof v === 'string' ? v.trim() : v), validate: (v) => typeof v === 'string' }),
    twitch: TWITCH_SCHEMA
  }
})

// Secrets are refused as a whole: either everything in an update is valid, or nothing is applied
function apply(updates: DeepPartial<Secrets>): void {
  const { clean, rejected } = secrets.validateConfigUpdates(updates)
  if (rejected.length) throw new AppError('INVALID_INPUT', `invalid secrets: ${rejected.join(', ')}`, { fields: rejected.join(', ') })

  secrets.updateConfig(clean)
}

export const getSecrets = (): Secrets => secrets.getConfig()

export function updateSecrets(updates: SecretsUpdates): Secrets {
  if (updates.youtubeApiKey !== undefined) apply({ youtubeApiKey: updates.youtubeApiKey })

  return getSecrets()
}

export function updateTwitchOAuthState(updates: Partial<TwitchSecrets>): void {
  if (Object.keys(updates).length === 0) return

  apply({ twitch: updates })
  // the account (or its token) changed: the panel reads the connection again
  emit('twitch')
}

export function clearTwitchOAuthState(): void {
  const { tokenData, userInfo, connectedAt } = getSecrets().twitch
  if (tokenData === null && userInfo === null && connectedAt === null) return

  updateTwitchOAuthState({
    tokenData: null,
    userInfo: null,
    connectedAt: null
  })
}

// only the last 4 characters are shown
function maskSecret(value: string): string {
  if (!value) return ''
  if (value.length <= 4) return '•'.repeat(value.length)
  return `${'•'.repeat(value.length - 4)}${value.slice(-4)}`
}

declare const __BAKED_ENV__: Record<string, string> | undefined
const baked = (key: string) => (typeof __BAKED_ENV__ !== 'undefined' ? __BAKED_ENV__[key] : '')

export const getTwitchClientId = (): string => process.env.TWITCH_CLIENT_ID?.trim() || baked('TWITCH_CLIENT_ID') || ''

export function getPublicSecretsView() {
  const { youtubeApiKey, twitch } = getSecrets()

  return {
    youtubeApiKey: maskSecret(youtubeApiKey),
    hasYoutubeApiKey: youtubeApiKey.length > 0,

    twitch: {
      configured: getTwitchClientId() !== '',
      connected: twitch.tokenData !== null && twitch.userInfo !== null,
      user: twitch.userInfo
        ? {
            displayName: twitch.userInfo.displayName,
            login: twitch.userInfo.login,
            profileImageUrl: twitch.userInfo.profileImageUrl
          }
        : null,
      connectedAt: twitch.connectedAt
    }
  }
}

export type SecretsResponse = ReturnType<typeof getPublicSecretsView>
