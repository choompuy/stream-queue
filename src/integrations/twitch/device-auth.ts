import { setTimeout as sleep } from 'node:timers/promises'
import type { TwitchDeviceCodeResponse, TwitchUserInfo } from './types.js'
import { getRuntime, twitchBackoff } from './state.js'
import { isRetryable } from './error.js'
import { clearTwitchAuthorization, clearTwitchOAuthState, getPublicSecretsView, updateTwitchOAuthState } from '../../secrets.js'
import { notify } from '../../state-events.js'
import { AppError } from '../../types.js'
import { createLogger, describeError } from '../../logger.js'

// The device-code login: the panel asks for a code, the viewer enters it on twitch.tv/activate,
// and the poll that waits for it turns into a connected account - or rolls the tokens back.
// The lifecycle (index.ts) owns the public entry point and hands this module the socket starter,
// so the module does not need to import it back.

const log = createLogger('TWITCH')

const USER_INFO_RETRY_ATTEMPTS = 3

let deviceAuthorizationPromise: Promise<unknown> | null = null
let deviceAuthorizationGeneration = 0

// What a login that waits for the code finds out is not used any more once it is cancelled (it only logs that it was)
export function cancelDeviceAuthorization(): void {
  if (deviceAuthorizationPromise) log.info('Device authorization cancelled')

  deviceAuthorizationGeneration++
  deviceAuthorizationPromise = null
  clearTwitchAuthorization()
}

/**
 * Starts the device-code login: a code is requested for the panel, and the returned promise settles
 * once the code is on its way (the login itself keeps running in the background and reports itself).
 */
export async function runDeviceAuthorization(startSockets: () => Promise<void>): Promise<TwitchDeviceCodeResponse> {
  const runtime = getRuntime()
  if (!runtime) {
    throw new AppError('TWITCH_AUTH_ERROR')
  }

  if (getPublicSecretsView().twitch.connected) {
    throw new AppError('TWITCH_AUTH_ERROR', 'Twitch account is already connected')
  }

  // a closed dialog must not lock the next attempt for the minutes the old code stays valid: a new start replaces the waiting one
  cancelDeviceAuthorization()
  const generation = deviceAuthorizationGeneration

  const device = await runtime.oauth.requestDeviceCode()
  // another start (or a disconnect) came while the code was being requested: this one is no longer wanted
  if (generation !== deviceAuthorizationGeneration) throw new AppError('TWITCH_AUTH_ERROR', 'Twitch authorization was cancelled')

  // what the panel shows while the login waits (also after the page is reloaded): it ends with the login, however it ends
  updateTwitchOAuthState({
    authorization: { userCode: device.user_code, verificationUri: device.verification_uri, expiresAt: Date.now() + device.expires_in * 1000 }
  })

  deviceAuthorizationPromise = runtime.oauth
    .pollForToken(device.device_code, device.interval, device.expires_in, () => generation === deviceAuthorizationGeneration)
    .then(async () => {
      if (generation !== deviceAuthorizationGeneration) {
        throw new AppError('TWITCH_AUTH_ERROR', 'Device authorization was cancelled')
      }
      const current = getRuntime()
      if (!current) throw new AppError('TWITCH_AUTH_ERROR', 'Twitch client is not initialized')

      let fetchedUserInfo: TwitchUserInfo | null = null
      let lastError: unknown = null

      for (let attempt = 1; attempt <= USER_INFO_RETRY_ATTEMPTS; attempt++) {
        if (generation !== deviceAuthorizationGeneration) {
          throw new AppError('TWITCH_AUTH_ERROR', 'Device authorization was cancelled')
        }

        try {
          fetchedUserInfo = await current.client.getUserInfo()
          break
        } catch (error) {
          lastError = error
          // a refusal (4xx) or a refused token gives the same answer every time: repeating it only delays the rollback
          if (attempt === USER_INFO_RETRY_ATTEMPTS || !isRetryable(error)) break
          log.warn(`getUserInfo attempt ${attempt} failed, retrying: ${describeError(error)}`)
          await sleep(twitchBackoff.delayMs * 2 ** (attempt - 1))
        }
      }

      if (!fetchedUserInfo) {
        log.error(`getUserInfo failed: ${describeError(lastError)}`)
        if (generation === deviceAuthorizationGeneration) {
          await current.oauth.revokeTokens()
          current.oauth.clearTokenData()
          clearTwitchOAuthState()
          throw lastError instanceof AppError
            ? lastError
            : new AppError('TWITCH_AUTH_ERROR', 'Failed to fetch user info after successful login. Please try connecting again.')
        }
        throw new AppError('TWITCH_AUTH_ERROR', 'Device authorization was cancelled')
      }

      if (generation !== deviceAuthorizationGeneration) {
        throw new AppError('TWITCH_AUTH_ERROR', 'Device authorization was cancelled')
      }

      updateTwitchOAuthState({
        userInfo: fetchedUserInfo,
        connectedAt: Date.now()
      })

      await startSockets()

      log.info(`Twitch account connected: ${fetchedUserInfo.displayName}`)
      return fetchedUserInfo
    })
    // nobody awaits this promise: a refusal, an expired code or a cancel is logged here instead of becoming an unhandled rejection
    .catch((error) => {
      if (generation !== deviceAuthorizationGeneration) {
        log.info('Twitch authorization was cancelled')
        return
      }

      log.error(`Twitch authorization failed: ${describeError(error)}`)

      // a non-AppError is a bug: it stays in the log above, and the panel gets the generic auth failure
      const failure = error instanceof AppError ? error : undefined
      notify({
        type: 'error',
        level: 'error',
        code: failure?.code ?? 'TWITCH_AUTH_ERROR',
        params: failure?.toParams()
      })
    })
    .finally(() => {
      if (generation !== deviceAuthorizationGeneration) return

      deviceAuthorizationPromise = null
      clearTwitchAuthorization()
    })

  return device
}

/** @internal Forgets a waiting login (used by the integration reset). */
export function resetDeviceAuthorization(): void {
  deviceAuthorizationPromise = null
  deviceAuthorizationGeneration = 0
}
