import { dataPath, type DeepPartial } from './persist.js'
import { createConfigModule, field, type DeepReadonly, type FieldRule, type Schema } from './config-helper.js'
import { getTwitchClientId } from './env.js'
import { AppError, type TwitchAuthorization, type TwitchSecrets, type TwitchTokenData, type TwitchUserInfo } from './types.js'

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
  // the account (or its key) changed: the panel reads the connection again
  topics: ['twitch'],
  schema: {
    // An empty string is allowed: it clears the key. No format is enforced (YouTube's own has changed over the
    // years), only a length cap, so a pasted blob cannot end up stored as "the key"
    youtubeApiKey: field({ normalize: (v) => (typeof v === 'string' ? v.trim() : v), validate: (v) => typeof v === 'string' && v.length <= 200 }),
    twitch: TWITCH_SCHEMA
  }
})

// Secrets are refused as a whole: either everything in an update is valid, or nothing is applied.
// Strict mode validates exactly once on the way in (updateConfig would validate a second time)
function apply(updates: DeepPartial<Secrets>): void {
  const { rejected } = secrets.updateConfigStrict(updates)
  if (rejected.length) throw new AppError('INVALID_INPUT', undefined, { fields: rejected.join(', ') })
}

export const getSecrets = (): DeepReadonly<Secrets> => secrets.getConfig()

// Narrow getter: the YouTube layer needs one key, not the Twitch tokens that live in the same file
export function getYoutubeApiKey(): string {
  return getSecrets().youtubeApiKey
}

export function updateSecrets(updates: SecretsUpdates): DeepReadonly<Secrets> {
  if (updates.youtubeApiKey !== undefined) apply({ youtubeApiKey: updates.youtubeApiKey })

  return getSecrets()
}

export function updateTwitchOAuthState(updates: Partial<TwitchSecrets>, immediate = false): void {
  if (Object.keys(updates).length === 0) return

  apply({ twitch: updates })

  // Save token data immediately to avoid losing it on process exit
  if (immediate && updates.tokenData) {
    void secrets.saveNow()
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
