import { TwitchOAuth } from './oauth.js'
import { TwitchClient } from './client.js'
import { TwitchEventSub } from './eventsub.js'
import { TwitchChat } from './chat.js'
import { ReconnectingSocket } from './socket.js'
import type {
  TwitchAuthConfig,
  TwitchUserInfo,
  TwitchDeviceCodeResponse,
  TwitchAuthorizationState,
  TwitchHealthView
} from './types.js'
import { clearTwitchOAuthState, getSecrets, updateTwitchOAuthState } from '../../secrets.js'
import { detachChannelPointsRedemptions } from '../../queue.js'
import { registerRedemptionHandler } from '../../finish.js'
import { AppError } from '../../types.js'
import { createLogger, describeError } from '../../logger.js'
import { normalizeTwitchError } from './error.js'
import {
  getRuntime,
  setRuntime,
  eventSubConnection,
  chatConnection,
  applyTunables,
  type TwitchTunables,
  type SocketState
} from './state.js'
import { handleChatMessage, resetCommandCooldowns } from './chat-commands.js'
import { handleChannelPointsRedemption, handleChannelPointsPlaybackOutcome, resetHandledRedemptions } from './redemptions.js'
import { cancelDeviceAuthorization, getAuthorizationOutcome, runDeviceAuthorization, resetDeviceAuthorization } from './device-auth.js'

const log = createLogger('TWITCH')
const chatLog = createLogger('TWITCH CHAT')

// The two long-lived sockets of a connected account, written once and driven the same way everywhere:
// start, stop and the test reset walk the list instead of naming each socket three times over.
// The live state of each entry lives in state.ts (chat-commands reads the chat one to wait it out)
interface ManagedSocket<T extends ReconnectingSocket> {
  name: string
  logger: ReturnType<typeof createLogger>
  create: () => T | null
  state: SocketState<T>
}

const eventSubSocket: ManagedSocket<TwitchEventSub> = {
  name: 'Twitch EventSub',
  logger: log,
  state: eventSubConnection,
  create: () => {
    const runtime = getRuntime()
    if (!runtime?.client.getCachedUserInfo()) {
      log.info('Twitch account not connected, EventSub will not start')
      return null
    }

    if (!runtime.oauth.getConfig().clientId) {
      log.info('Twitch client ID not configured, EventSub will not start')
      return null
    }

    return new TwitchEventSub({
      client: runtime.client,
      onChannelPointsRedemption: (event) => handleChannelPointsRedemption(event, runtime.client)
    })
  }
}

const chatSocket: ManagedSocket<TwitchChat> = {
  name: 'Twitch chat',
  logger: chatLog,
  state: chatConnection,
  create: () => {
    const runtime = getRuntime()
    const userInfo = runtime?.client.getCachedUserInfo()
    if (!runtime || !userInfo) {
      chatLog.info('Twitch account not connected, chat will not start')
      return null
    }

    // Started whenever the account is connected, with or without enabled commands: the replies to redemptions
    // (accepted, refunded) go through the chat too, and which commands react is decided per message
    return new TwitchChat({
      oauth: runtime.oauth,
      channelLogin: userInfo.login,
      onMessage: handleChatMessage
    })
  }
}

const managedSockets: ManagedSocket<ReconnectingSocket>[] = [eventSubSocket, chatSocket]

export function initializeTwitchIntegration(config: Partial<TwitchAuthConfig> = {}, options: Partial<TwitchTunables> = {}): void {
  if (getRuntime()) {
    log.info('Twitch integration already initialized')
    return
  }

  if (!config.clientId) {
    log.info('Twitch client ID not configured, integration will not be functional')
    return
  }

  // the waits and retries of this integration instance come from the options (the defaults are the real pace);
  // this is the only place they are written
  applyTunables(options)

  const oauth = new TwitchOAuth({
    clientId: config.clientId,
    scopes: config.scopes,
    onTokenUpdated: (tokenData) => {
      updateTwitchOAuthState({ tokenData }, true)
    }
  })
  const twitchClient = new TwitchClient(oauth)
  setRuntime({ oauth, client: twitchClient })

  const secrets = getSecrets()

  if (secrets.twitch.tokenData) {
    oauth.setTokenData(secrets.twitch.tokenData)
    log.info('Restored Twitch token data from storage')
  }

  if (secrets.twitch.userInfo) {
    twitchClient.setCachedUserInfo(secrets.twitch.userInfo)
    log.info('Restored Twitch user info from storage')
  }

  registerRedemptionHandler((tracked, outcome) => handleChannelPointsPlaybackOutcome(tracked, outcome, twitchClient))

  log.info('Twitch integration initialized')

  void startSockets()
}

// Without a network at startup the integration must not stay dead: the same instance keeps retrying by itself
async function connectOrRetry(socket: ReconnectingSocket, name: string, logger: ReturnType<typeof createLogger>): Promise<void> {
  try {
    await socket.connect()
    logger.info(`${name} connected`)
  } catch (error) {
    const normalized = normalizeTwitchError(error)
    logger.error(`Failed to start ${name}, will keep retrying: ${describeError(normalized)}`)
    socket.retryInBackground()
  }
}

async function connectSocket(entry: ManagedSocket<ReconnectingSocket>): Promise<void> {
  if (!getRuntime()) return

  // a socket that says it cannot exist yet (no account, no client id) logs its own reason and stays null.
  // The instance is captured: a test mock that replaces it mid-start must not redirect this connection
  const socket = (entry.state.instance ??= entry.create())
  if (!socket) return

  if (!socket.isConnected()) await connectOrRetry(socket, entry.name, entry.logger)
}

// One start per socket at a time: a second caller joins the start already running instead of racing it
function startSocket(entry: ManagedSocket<ReconnectingSocket>): Promise<void> {
  entry.state.starting ??= connectSocket(entry).finally(() => {
    entry.state.starting = null
  })
  return entry.state.starting
}

/** Starts the sockets of the connected account: each one's setup begins at once, as before (two voids became one call). */
async function startSockets(): Promise<void> {
  await Promise.all(managedSockets.map((entry) => startSocket(entry)))
}

/** Starts the device-code login: the flow lives in device-auth.ts, this stays the single public entry point. */
export function startDeviceAuthorization(): Promise<TwitchDeviceCodeResponse> {
  return runDeviceAuthorization(startSockets)
}

export type TwitchHealth = TwitchHealthView

// when the connection entered the state it is in now: a change of the state (or the first look at it) starts the clock
let healthSignature: string | null = null
let healthSince = 0

export function getTwitchHealth(): TwitchHealth {
  // named fields by name: the typed answer of the panel - the list would only hide what is written
  const health: Omit<TwitchHealth, 'since'> = {
    auth: getRuntime()?.oauth.needsReauthorization() ? 'reauthorize' : 'ok',
    eventSub: eventSubConnection.instance?.isConnected() ?? false,
    chat: chatConnection.instance?.isConnected() ?? false
  }

  const signature = JSON.stringify(health)
  if (signature !== healthSignature) {
    healthSignature = signature
    healthSince = Date.now()
  }

  return { ...health, since: healthSince }
}

/** The state of the login as the panel sees it: a code that waits, or how the last one ended. Nothing to show is null. */
export function describeAuthorization(pending: { userCode: string; verificationUri: string; expiresAt: number } | null): TwitchAuthorizationState | null {
  if (pending) return { ...pending, state: 'pending' }
  return getAuthorizationOutcome()
}

/** Disconnects the account. Returns how many queued redemptions were left UNFULFILLED on Twitch for the streamer to close by hand. */
export async function disconnect(): Promise<number> {
  const runtime = getRuntime()
  if (!runtime) {
    log.info('Twitch integration not initialized, nothing to disconnect')
    return 0
  }

  for (const entry of managedSockets) {
    if (entry.state.instance) {
      await entry.state.instance.disconnect()
      entry.state.instance = null
    }
  }

  // a login that is still waiting for the code must not bring the account back after the disconnect
  cancelDeviceAuthorization()

  const detached = detachChannelPointsRedemptions()
  if (detached > 0) log.warn(`${detached} queued redemption(s) stay UNFULFILLED on Twitch: fulfill or refund them in the rewards queue`)

  // asked before the tokens are forgotten locally; a failure does not stop the disconnect
  await runtime.oauth.revokeTokens()

  runtime.oauth.clearTokenData()
  runtime.client.clearUserInfo()
  clearTwitchOAuthState()

  log.info('Twitch account disconnected')
  return detached
}

export async function refreshConnection(): Promise<TwitchUserInfo> {
  const runtime = getRuntime()
  if (!runtime) throw new AppError('TWITCH_REFRESH_ERROR')

  try {
    const userInfo = await runtime.client.getUserInfo()

    updateTwitchOAuthState({ userInfo })

    await startSockets()

    log.info('Twitch connection refreshed')
    return userInfo
  } catch (error) {
    log.error(`Failed to refresh connection: ${describeError(error)}`)
    throw error
  }
}

// The panel is told this instead of a masked clone of the secrets: the routes only need the boolean
export function isTwitchConnected(): boolean {
  const runtime = getRuntime()
  return runtime !== null && runtime.oauth.isAuthenticated() && runtime.client.getCachedUserInfo() !== null
}

/**
 * Tears the integration down without touching the account: both sockets are closed, the runtime is dropped and
 * the per-run memories (command cooldowns, seen redemptions, a waiting device-code login) are cleared. The
 * counterpart of initializeTwitchIntegration: the server shutdown calls it before saving, so nothing changes
 * state while it is being written. The account itself is only disconnected by disconnect(), which revokes.
 */
export async function stop(): Promise<void> {
  for (const entry of managedSockets) {
    if (entry.state.instance) await entry.state.instance.disconnect()
    entry.state.instance = null
    entry.state.starting = null
  }

  setRuntime(null)
  resetCommandCooldowns()
  resetHandledRedemptions()
  resetDeviceAuthorization()
}
