import { dataPath, type DeepPartial } from './persist.js'
import { createConfigModule, field, type FieldRule, type Schema } from './config-helper.js'
import { emit } from './state-events.js'
import { getTwitchClientId } from './env.js'
import { AppError, type TwitchAuthorization, type TwitchSecrets, type TwitchTokenData, type TwitchUserInfo } from './types.js'
import { createLogger, describeError } from './logger.js'

const log = createLogger('SECRETS')

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

function isValidAuthorization(value: unknown): value is TwitchAuthorization {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>

  return typeof v.userCode === 'string' && typeof v.verificationUri === 'string' && typeof v.expiresAt === 'number' && Number.isFinite(v.expiresAt)
}

const nullable = (isValid: (value: unknown) => boolean): FieldRule => field({ validate: (v) => v === null || isValid(v) })

const TWITCH_SCHEMA: Schema = {
  tokenData: nullable(isValidTokenData),
  userInfo: nullable(isValidUserInfo),
  connectedAt: nullable((v) => typeof v === 'number' && Number.isFinite(v)),
  authorization: nullable(isValidAuthorization)
}

const secrets = createConfigModule<Secrets>({
  filePath: () => dataPath('secrets.json'),
  defaults: { youtubeApiKey: '', twitch: { tokenData: null, userInfo: null, connectedAt: null, authorization: null } },
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

export function updateTwitchOAuthState(updates: Partial<TwitchSecrets>, immediate = false): void {
  if (Object.keys(updates).length === 0) return

  apply({ twitch: updates })
  // the account (or its token) changed: the panel reads the connection again
  emit('twitch')

  // Save token data immediately to avoid losing it on process exit
  if (immediate && updates.tokenData) {
    secrets.saveNow((error) => log.error(`Failed to save secrets: ${describeError(error)}`))
  }
}

export function clearTwitchOAuthState(): void {
  const { tokenData, userInfo, connectedAt, authorization } = getSecrets().twitch
  if (tokenData === null && userInfo === null && connectedAt === null && authorization === null) return

  updateTwitchOAuthState({
    tokenData: null,
    userInfo: null,
    connectedAt: null,
    authorization: null
  })
}

// A login that waits for the code lives in the memory of the process that started it, and ends when that process does:
// whatever is still written here after a start is left over, and must not make the panel wait for a code nobody checks
export function clearTwitchAuthorization(): void {
  if (getSecrets().twitch.authorization === null) return

  updateTwitchOAuthState({ authorization: null })
}

// only the last 4 characters are shown
function maskSecret(value: string): string {
  if (!value) return ''
  if (value.length <= 4) return '•'.repeat(value.length)
  return `${'•'.repeat(value.length - 4)}${value.slice(-4)}`
}

// `includeAuthorization`: the address of a login that waits for its code lets whoever opens it connect THEIR Twitch account
// instead of the streamer's, so it is given to this computer only (the panel on it), never to the rest of the network
export function getPublicSecretsView({ includeAuthorization = false }: { includeAuthorization?: boolean } = {}) {
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
      connectedAt: twitch.connectedAt,
      // an expired code is no login any more, whatever the file still says
      authorization: includeAuthorization && twitch.authorization && twitch.authorization.expiresAt > Date.now() ? twitch.authorization : null
    }
  }
}

export type SecretsResponse = ReturnType<typeof getPublicSecretsView>
