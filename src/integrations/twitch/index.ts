import { TwitchOAuth } from './oauth.js'
import { TwitchClient } from './client.js'
import { TwitchEventSub } from './eventsub.js'
import { TwitchChat } from './chat.js'
import type {
  TwitchAuthConfig,
  TwitchChannelPointsRedemption,
  TwitchUserInfo,
  TwitchDeviceCodeResponse,
  TwitchChatMessage,
  TwitchChatPermission
} from './types.js'
import { clearTwitchOAuthState, getPublicSecretsView, getSecrets, updateTwitchOAuthState } from '../../secrets.js'
import { detachChannelPointsRedemptions, requestSong, setPaused } from '../../queue.js'
import {
  buildNowPlayingMessage,
  buildQueueMessage,
  buildSkipMessage,
  buildRedemptionAcceptedMessage,
  buildRedemptionRejectionMessage,
  buildRedemptionRefundFailedMessage
} from '../../chat-replies.js'
import { translateWithFallback } from '../../i18n.js'
import { getTwitchConfig, CHAT_COMMAND_KEYS } from './config.js'
import { getState, skipCurrent } from '../../player.js'
import { registerRedemptionHandler, type RedemptionOutcome } from '../../finish.js'
import { AppError } from '../../types.js'
import type { FailureReason, QueueItem } from '../../types.js'
import { createLogger } from '../../logger.js'

const log = createLogger('TWITCH')
const chatLog = createLogger('TWITCH CHAT')

const REDEMPTION_RETRY_ATTEMPTS = 3
const REDEMPTION_RETRY_DELAY_MS = 1000
let retryDelayMs = REDEMPTION_RETRY_DELAY_MS

let oauth: TwitchOAuth | null = null
let client: TwitchClient | null = null
let eventSub: TwitchEventSub | null = null
let chat: TwitchChat | null = null
let deviceAuthorizationPromise: Promise<unknown> | null = null
let deviceAuthorizationGeneration = 0
const lastRun = { plainCooldownSeconds: 0, controlCooldownSeconds: 0 }

// what is kept with a queued track about the redemption that paid for it
type TrackedRedemption = NonNullable<QueueItem['channelPointsRedemption']>

const trackRedemption = (event: TwitchChannelPointsRedemption): TrackedRedemption => ({
  id: event.id,
  rewardId: event.reward.id,
  userName: event.user_name
})

function handleChannelPointsPlaybackOutcome(tracked: TrackedRedemption, outcome: RedemptionOutcome): void {
  if (outcome.status === 'failed') {
    void cancelRedemption(tracked, client, outcome.reason)
    return
  }

  if (!getTwitchConfig().autoFulfillRedemptions) {
    log.log(`Redemption ${tracked.id} finished playback, left unfulfilled (auto-fulfill disabled)`)
    return
  }

  void fulfillRedemption(tracked, client)
}

export function initializeTwitchIntegration(config: Partial<TwitchAuthConfig> = {}): void {
  if (oauth) {
    log.log('Twitch integration already initialized')
    return
  }

  oauth = new TwitchOAuth({
    clientId: config.clientId || '',
    scopes: config.scopes,
    onTokenUpdated: (tokenData) => {
      updateTwitchOAuthState({ tokenData })
    }
  })
  client = new TwitchClient(oauth)

  const secrets = getSecrets()

  if (secrets.twitch.tokenData) {
    oauth.setTokenData(secrets.twitch.tokenData)
    log.log('Restored Twitch token data from storage')
  }

  if (secrets.twitch.userInfo) {
    client.setCachedUserInfo(secrets.twitch.userInfo)
    log.log('Restored Twitch user info from storage')
  }

  registerRedemptionHandler(handleChannelPointsPlaybackOutcome)

  log.log('Twitch integration initialized')

  void startEventSub()
  void startChat()
}

async function handleChannelPointsRedemption(event: TwitchChannelPointsRedemption): Promise<void> {
  log.log(`Channel Points redemption: ${event.reward.title} by ${event.user_name}`)

  const configuredRewardId = getTwitchConfig().channelPointsRewardId
  if (!configuredRewardId || event.reward.id !== configuredRewardId) {
    log.log(`Ignoring redemption with non-matching reward ID: ${event.reward.id} (configured: ${configuredRewardId || 'none'})`)
    return
  }

  const tracked = trackRedemption(event)

  const query = event.user_input.trim()
  if (!query) {
    log.error(`Empty song request in redemption: ${event.id}`)
    await cancelRedemption(tracked, client, { code: 'SONG_NOT_FOUND' })
    return
  }

  if (!client) {
    log.error(`Twitch client is not initialized for redemption: ${event.id}`)
    return
  }

  const result = await requestSong(query, event.user_name, false, tracked)

  if (result.outcome !== 'added') {
    const reason: FailureReason =
      result.outcome === 'invalid-url' ? { code: 'INVALID_YOUTUBE_URL' } : result.outcome === 'not-found' ? { code: 'SONG_NOT_FOUND' } : result.reason

    log.error(`Song request failed for redemption ${event.id}: ${result.outcome}`)
    await cancelRedemption(tracked, client, reason)
    return
  }

  // The account can be disconnected while the song is being looked up. The track is queued by now, but there is
  // no login left to close the redemption with, so it is left for the streamer like the others
  if (!oauth?.isAuthenticated()) {
    const detached = detachChannelPointsRedemptions()
    log.warn(`Twitch was disconnected while redemption ${event.id} was being handled: ${detached} queued redemption(s) stay UNFULFILLED on Twitch`)
    return
  }

  log.log(`Redemption ${event.id} added to queue`)
  await replyInChat(buildRedemptionAcceptedMessage(event.user_name, result.added))
}

async function startEventSub(): Promise<void> {
  if (!oauth || !client) return

  // already created: if it is down (it gave up earlier, or the first connect failed) it is woken up, not replaced
  if (eventSub) {
    if (!eventSub.isConnected()) await eventSub.connect().catch(() => eventSub?.retryInBackground())
    return
  }

  if (!client.getCachedUserInfo()) {
    log.log('Twitch account not connected, EventSub will not start')
    return
  }

  if (!oauth.getConfig().clientId) {
    log.log('Twitch client ID not configured, EventSub will not start')
    return
  }

  eventSub = new TwitchEventSub({
    client,
    onChannelPointsRedemption: handleChannelPointsRedemption
  })

  try {
    await eventSub.connect()
    log.log('Twitch EventSub connected')
  } catch (error) {
    // without a network at startup the integration must not stay dead: the same instance keeps retrying by itself
    log.error(`Failed to start EventSub, will keep retrying: ${error instanceof Error ? error.message : error}`)
    eventSub.retryInBackground()
  }
}

function hasPermission(message: TwitchChatMessage, permission: TwitchChatPermission): boolean {
  switch (permission) {
    case 'everyone':
      return true
    case 'moderator':
      return message.isModerator || message.isBroadcaster
    case 'broadcaster':
      return message.isBroadcaster
  }
}

// A command word must be the whole message (or the first word, for forward-compatibility with arguments),
// case-insensitive - "!sg skip" matches "!sg skip", "!SG SKIP", and "!sg skip please"
// but not "!sg skipping" or a message that merely contains it midway through
function matchesCommand(text: string, command: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ')
  return normalized === command || normalized.startsWith(`${command} `)
}

const CHAT_START_WAIT_MS = 5000

async function replyInChat(message: string): Promise<void> {
  if (!chat?.isConnected() && chatStart) await Promise.race([chatStart, wait(CHAT_START_WAIT_MS)])
  if (!chat) return
  await chat.sendMessage(message).catch((error) => {
    chatLog.error(`Failed to send chat reply: ${error instanceof Error ? error.message : error}`)
  })
}

// One global (not per-user) cooldown per kind of command: two moderators can't double up on skip/pause/resume,
// and now/queue can't be spammed
async function runCommand(message: TwitchChatMessage, cooldown: keyof typeof lastRun, cooldownSeconds: number, action: () => string): Promise<void> {
  const now = Date.now()
  if (now - lastRun[cooldown] < cooldownSeconds * 1000) {
    chatLog.log(`Ignored a command from ${message.displayName}: cooldown active`)
    return
  }
  lastRun[cooldown] = now

  await replyInChat(action())
}

const COMMANDS: Record<(typeof CHAT_COMMAND_KEYS)[number], { cooldown: keyof typeof lastRun; run: () => string }> = {
  now: { cooldown: 'plainCooldownSeconds', run: buildNowPlayingMessage },
  queue: { cooldown: 'plainCooldownSeconds', run: buildQueueMessage },
  skip: {
    cooldown: 'controlCooldownSeconds',
    run: () => {
      skipCurrent()
      return buildSkipMessage(getState())
    }
  },
  pause: {
    cooldown: 'controlCooldownSeconds',
    run: () => {
      setPaused(true)
      return translateWithFallback('chat.paused', undefined, 'Player paused')
    }
  },
  resume: {
    cooldown: 'controlCooldownSeconds',
    run: () => {
      setPaused(false)
      return translateWithFallback('chat.resumed', undefined, 'Playback resumed')
    }
  }
}

async function handleChatMessage(message: TwitchChatMessage): Promise<void> {
  const commands = getTwitchConfig().chatCommands

  for (const key of CHAT_COMMAND_KEYS) {
    const { enabled, command, permission } = commands[key]
    if (!enabled || !matchesCommand(message.text, command) || !hasPermission(message, permission)) continue

    chatLog.log(`Command "${command}" from ${message.displayName}`)
    const { cooldown, run } = COMMANDS[key]
    await runCommand(message, cooldown, commands[cooldown], run)
    return
  }
}

let chatStart: Promise<void> | null = null

function startChat(): Promise<void> {
  chatStart ??= connectChat().finally(() => {
    chatStart = null
  })
  return chatStart
}

async function connectChat(): Promise<void> {
  if (!oauth || !client) return

  if (chat) {
    if (!chat.isConnected()) await chat.connect().catch(() => chat?.retryInBackground())
    return
  }

  const userInfo = client.getCachedUserInfo()
  if (!userInfo) {
    chatLog.log('Twitch account not connected, chat will not start')
    return
  }

  // Started whenever the account is connected, with or without enabled commands: the replies to redemptions
  // (accepted, refunded) go through the chat too, and which commands react is decided per message
  chat = new TwitchChat({
    oauth,
    channelLogin: userInfo.login,
    botLogin: userInfo.login,
    onMessage: handleChatMessage
  })

  try {
    await chat.connect()
    chatLog.log('Twitch chat connected')
  } catch (error) {
    chatLog.error(`Failed to start chat, will keep retrying: ${error instanceof Error ? error.message : error}`)
    chat.retryInBackground()
  }
}

export async function startDeviceAuthorization(): Promise<TwitchDeviceCodeResponse> {
  if (!oauth || !client) {
    throw new AppError('TWITCH_AUTH_ERROR', 'Twitch integration not initialized')
  }

  if (getPublicSecretsView().twitch.connected) {
    throw new AppError('TWITCH_AUTH_ERROR', 'Twitch account is already connected')
  }

  if (deviceAuthorizationPromise) {
    throw new AppError('TWITCH_AUTH_ERROR', 'Twitch authorization is already in progress')
  }

  const device = await oauth.requestDeviceCode()
  const generation = ++deviceAuthorizationGeneration

  deviceAuthorizationPromise = oauth
    .pollForToken(device.device_code, device.interval, device.expires_in)
    .then(async () => {
      if (generation !== deviceAuthorizationGeneration) {
        throw new Error('Device authorization was cancelled')
      }
      if (!client) throw new AppError('TWITCH_AUTH_ERROR', 'Twitch client is not initialized')

      const userInfo = await client.getUserInfo()

      updateTwitchOAuthState({
        userInfo,
        connectedAt: Date.now()
      })

      await startEventSub()
      await startChat()

      log.log(`Twitch account connected: ${userInfo.displayName}`)
      return userInfo
    })
    // nobody awaits this promise: a refusal, an expired code or a cancel is logged here instead of becoming an unhandled rejection
    .catch((error) => {
      if (generation === deviceAuthorizationGeneration) log.error(`Twitch authorization failed: ${error instanceof Error ? error.message : error}`)
      else log.log('Twitch authorization was cancelled')
    })
    .finally(() => {
      if (generation === deviceAuthorizationGeneration) deviceAuthorizationPromise = null
    })

  return device
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// A repeat helps only when the failure can pass by itself: a lost connection or a timeout (they arrive as plain errors),
// a 429, a 5xx, or a login that could not be refreshed right now (flagged `transient`). A refusal (4xx), a missing
// login or a token Twitch no longer accepts gives the same answer every time
export function isRetryable(error: unknown): boolean {
  if (!(error instanceof AppError)) return true
  if (error.params?.transient === 1) return true

  const status = error.params?.status
  return typeof status === 'number' && (status === 429 || status >= 500)
}

// Twitch answers 404 when there is no UNFULFILLED redemption with that id: the streamer already closed it in the rewards
// queue, or the reward was deleted. (A 400 means the request itself is wrong, so it stays a failure)
const isNoLongerOpen = (error: unknown): boolean => error instanceof AppError && error.params?.status === 404

type RedemptionUpdate = 'done' | 'no-longer-open' | 'failed'

// Sets the status with retries and backoff. Returns whether Twitch accepted it
async function setRedemptionStatus(
  redemption: TrackedRedemption,
  twitchClient: TwitchClient,
  status: 'FULFILLED' | 'CANCELED'
): Promise<RedemptionUpdate> {
  for (let attempt = 1; attempt <= REDEMPTION_RETRY_ATTEMPTS; attempt++) {
    try {
      await twitchClient.updateRedemptionStatus(redemption, status)
      return 'done'
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)

      if (isNoLongerOpen(error)) {
        log.log(
          `Redemption ${redemption.id} is not open any more (closed in the Twitch rewards queue, or its reward was deleted): ${status} not needed`
        )
        return 'no-longer-open'
      }

      if (attempt === REDEMPTION_RETRY_ATTEMPTS || !isRetryable(error)) {
        log.error(`Failed to set redemption ${redemption.id} to ${status} after ${attempt} attempt(s): ${reason}`)
        return 'failed'
      }

      const delay = retryDelayMs * 2 ** (attempt - 1)
      log.error(
        `Failed to set redemption ${redemption.id} to ${status} (attempt ${attempt}/${REDEMPTION_RETRY_ATTEMPTS}): ${reason}. Retrying in ${delay}ms`
      )
      await wait(delay)
    }
  }

  return 'failed'
}

async function fulfillRedemption(redemption: TrackedRedemption, twitchClient: TwitchClient | null): Promise<void> {
  if (!twitchClient) {
    log.error(`Cannot fulfill redemption ${redemption.id}: Twitch client not initialized`)
    return
  }

  const result = await setRedemptionStatus(redemption, twitchClient, 'FULFILLED')

  if (result === 'done') {
    log.log(`Channel Points redemption fulfilled: ${redemption.id}`)
    return
  }

  // already closed by the streamer: nothing is left to do or to worry about
  if (result === 'no-longer-open') return

  // The track was played: refunding the points now would give the viewer the song for free.
  // The redemption stays UNFULFILLED for the streamer or a moderator to close in the Twitch rewards queue
  log.error(`Redemption ${redemption.id} was played but could not be fulfilled, it is left for a manual decision`)
}

async function cancelRedemption(redemption: TrackedRedemption, twitchClient: TwitchClient | null, reason: FailureReason): Promise<void> {
  if (!twitchClient) {
    log.error(`Cannot cancel redemption ${redemption.id}: Twitch client not initialized`)
    await replyInChat(buildRedemptionRefundFailedMessage(redemption.userName))
    return
  }

  const result = await setRedemptionStatus(redemption, twitchClient, 'CANCELED')

  // "points refunded" goes to chat only when Twitch confirmed it: the points stay held otherwise
  if (result === 'done') {
    log.log(`Channel Points redemption canceled (points refunded): ${redemption.id}`)
    await replyInChat(buildRedemptionRejectionMessage(redemption.userName, reason))
    return
  }

  // Closed by the streamer in the meantime: whatever they chose (refund or accept) is already done, and either
  // message here ("refunded" or "could not be refunded") could be wrong. Nothing is said in chat
  if (result === 'no-longer-open') return

  await replyInChat(buildRedemptionRefundFailedMessage(redemption.userName))
}

export type TwitchHealth = {
  /** 'reauthorize': Twitch refused the saved token (a public client's refresh token lives 30 days), the account has to be connected again */
  auth: 'ok' | 'reauthorize'
  eventSub: boolean
  chat: boolean
}

export function getTwitchHealth(): TwitchHealth {
  return {
    auth: oauth?.needsReauthorization() ? 'reauthorize' : 'ok',
    eventSub: eventSub?.isConnected() ?? false,
    chat: chat?.isConnected() ?? false
  }
}

/** Disconnects the account. Returns how many queued redemptions were left UNFULFILLED on Twitch for the streamer to close by hand. */
export async function disconnect(): Promise<number> {
  if (!oauth || !client) {
    log.log('Twitch integration not initialized, nothing to disconnect')
    return 0
  }

  if (eventSub) {
    await eventSub.disconnect()
    eventSub = null
  }

  if (chat) {
    await chat.disconnect()
    chat = null
  }

  // Cancel any active device authorization to prevent "resurrection"
  deviceAuthorizationGeneration++
  if (deviceAuthorizationPromise) {
    deviceAuthorizationPromise = null
    log.log('Device authorization cancelled due to disconnect')
  }

  const detached = detachChannelPointsRedemptions()
  if (detached > 0) log.warn(`${detached} queued redemption(s) stay UNFULFILLED on Twitch: fulfill or refund them in the rewards queue`)

  // asked before the tokens are forgotten locally; a failure does not stop the disconnect
  await oauth.revokeTokens()

  oauth.clearTokenData()
  client.clearUserInfo()
  clearTwitchOAuthState()

  log.log('Twitch account disconnected')
  return detached
}

export async function refreshConnection(): Promise<TwitchUserInfo> {
  if (!oauth || !client) throw new AppError('TWITCH_REFRESH_ERROR', 'Twitch integration not initialized')

  try {
    const userInfo = await client.getUserInfo()

    updateTwitchOAuthState({ userInfo })

    await startEventSub()
    await startChat()

    log.log('Twitch connection refreshed')
    return userInfo
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    log.error(`Failed to refresh connection: ${reason}`)
    throw new AppError('TWITCH_REFRESH_ERROR', reason)
  }
}

// Export for internal use (routes)
export function getClient(): TwitchClient | null {
  return client
}

// Export for testing purposes only
export const _test = {
  hasPermission,
  matchesCommand,
  handleChatMessage,
  resetCooldown: () => {
    lastRun.plainCooldownSeconds = lastRun.controlCooldownSeconds = 0
  },
  setChat: (mock: TwitchChat | null) => {
    chat = mock
  },
  cancelRedemption,
  fulfillRedemption,
  setRetryDelay: (ms: number) => {
    retryDelayMs = ms
  }
}

// Export for testing purposes only
export async function _resetIntegration(): Promise<void> {
  if (eventSub) await eventSub.disconnect()
  if (chat) await chat.disconnect()

  oauth = null
  client = null
  eventSub = null
  chat = null
  deviceAuthorizationPromise = null
  deviceAuthorizationGeneration = 0
  lastRun.plainCooldownSeconds = lastRun.controlCooldownSeconds = 0
}
