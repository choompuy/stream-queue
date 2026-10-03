import { dataPath, createFileStore } from './persist.js'
import { field, validateUpdates, type FieldRule, type Schema } from './config-helper.js'
import { createLogger, describeError } from './logger.js'
import { AppError, type TwitchSecrets, type TwitchTokenData, type TwitchUserInfo } from './types.js'

export type Secrets = {
  youtubeApiKey: string
  twitch: TwitchSecrets
}

export type SecretsUpdates = {
  youtubeApiKey?: string
}

const log = createLogger('SECRETS')
const store = createFileStore<Secrets>(() => dataPath('secrets.json'))

// read from disk on first use, not when the module is imported
let secrets: Secrets | null = null

function current(): Secrets {
  return (secrets ??= store.load({
    youtubeApiKey: '',
    twitch: {
      tokenData: null,
      userInfo: null,
      connectedAt: null
    }
  }))
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

// An empty string is allowed: it clears the key
const API_SCHEMA: Schema = {
  youtubeApiKey: field({ normalize: (v) => (typeof v === 'string' ? v.trim() : v), validate: (v) => typeof v === 'string' })
}

const TWITCH_SCHEMA: Schema = {
  tokenData: nullable(isValidTokenData),
  userInfo: nullable(isValidUserInfo),
  connectedAt: nullable((v) => typeof v === 'number' && Number.isFinite(v))
}

function checked(schema: Schema, updates: unknown): Record<string, unknown> {
  const { clean, rejected } = validateUpdates(schema, updates)
  if (rejected.length) throw new AppError('INVALID_INPUT', `invalid secrets: ${rejected.join(', ')}`, { fields: rejected.join(', ') })
  return clean
}

export function getSecrets(): Secrets {
  return structuredClone(current())
}

export function updateSecrets(updates: SecretsUpdates): Secrets {
  const input = updates.youtubeApiKey === undefined ? {} : { youtubeApiKey: updates.youtubeApiKey }
  const { youtubeApiKey } = checked(API_SCHEMA, input) as SecretsUpdates

  if (youtubeApiKey !== undefined && youtubeApiKey !== current().youtubeApiKey) {
    secrets = { ...current(), youtubeApiKey }
    scheduleSave()
  }

  return getSecrets()
}

export function updateTwitchOAuthState(updates: Partial<TwitchSecrets>): void {
  if (Object.keys(updates).length === 0) return

  const clean = checked(TWITCH_SCHEMA, updates) as Partial<TwitchSecrets>

  secrets = {
    ...current(),
    twitch: {
      ...current().twitch,
      ...clean
    }
  }

  scheduleSave()
}

export function clearTwitchOAuthState(): void {
  const { tokenData, userInfo, connectedAt } = current().twitch
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
  const { youtubeApiKey, twitch } = current()

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

function scheduleSave(): void {
  store.scheduleSave(
    () => current(),
    (error) => log.error(`Failed to save: ${describeError(error)}`)
  )
}

export type SecretsResponse = ReturnType<typeof getPublicSecretsView>
