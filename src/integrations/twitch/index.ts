import { TwitchOAuth } from './oauth.js'
import { TwitchClient } from './client.js'
import { TwitchEventSub } from './eventsub.js'
import { TwitchChat } from './chat.js'
import type { TwitchAuthConfig, TwitchChannelPointsRedemption, TwitchUserInfo, TwitchDeviceCodeResponse, TwitchChatMessage } from './types.js'
import { clearTwitchOAuthState, getPublicSecretsView, getSecrets, updateTwitchOAuthState } from '../../secrets.js'
import { requestSong } from '../../queue.js'
import { skipCurrent } from '../../player.js'
import { setPaused } from '../../queue.js'
import { buildNowPlayingMessage, buildQueueMessage, buildSkipMessage } from '../../chat-replies.js'
import { translateWithFallback } from '../../i18n.js'
import { getConfig } from '../../config.js'
import { getState } from '../../player.js'
import { AppError, TwitchChatPermission } from '../../types.js'
import { createLogger } from '../../logger.js'

const log = createLogger('TWITCH EVENTSUB')
const chatLog = createLogger('TWITCH CHAT')

const REDEMPTION_RETRY_ATTEMPTS = 3
const REDEMPTION_RETRY_DELAY_MS = 1000

let oauth: TwitchOAuth | null = null
let client: TwitchClient | null = null
let eventSub: TwitchEventSub | null = null
let chat: TwitchChat | null = null
let deviceAuthorizationPromise: Promise<TwitchUserInfo> | null = null
let lastControlCommandAt = 0

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

  log.log('Twitch integration initialized')

  void startEventSub()
  void startChat()
}

export async function reinitializeTwitchIntegration(): Promise<void> {
  if (eventSub) {
    await eventSub.disconnect()
    eventSub = null
  }

  if (chat) {
    await chat.disconnect()
    chat = null
  }

  oauth = null
  client = null
  deviceAuthorizationPromise = null
  initializeTwitchIntegration()
}

async function handleChannelPointsRedemption(event: TwitchChannelPointsRedemption): Promise<void> {
  log.log(`Channel Points redemption: ${event.reward.title} by ${event.user_name}`)

  const configuredRewardId = getConfig().twitch.channelPointsRewardId
  if (!configuredRewardId || event.reward.id !== configuredRewardId) {
    log.log(`Ignoring redemption with non-matching reward ID: ${event.reward.id} (configured: ${configuredRewardId || 'none'})`)
    return
  }

  const query = event.user_input.trim()
  if (!query) {
    log.error(`Empty song request in redemption: ${event.id}`)
    return
  }

  if (!client) {
    log.error(`Twitch client is not initialized for redemption: ${event.id}`)
    return
  }

  const result = await requestSong(query, event.user_name, false)

  if (result.outcome !== 'added') {
    log.error(`Song request failed for redemption ${event.id}: ${result.outcome}`)
    return
  }

  await fulfillRedemption(event, client)
}

async function startEventSub(): Promise<void> {
  if (!oauth || !client) return
  if (eventSub) return

  const userInfo = client.getCachedUserInfo()
  if (!userInfo) {
    log.log('Twitch account not connected, EventSub will not start')
    return
  }

  const clientId = oauth.getConfig().clientId
  if (!clientId) {
    log.log('Twitch client ID not configured, EventSub will not start')
    return
  }

  eventSub = new TwitchEventSub({
    clientId,
    oauth,
    broadcasterUserId: userInfo.id,
    onChannelPointsRedemption: handleChannelPointsRedemption
  })

  try {
    await eventSub.connect()
    log.log('Twitch EventSub connected')
  } catch (error) {
    eventSub = null
    log.error(`Failed to start EventSub: ${error instanceof Error ? error.message : error}`)
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

async function replyInChat(message: string): Promise<void> {
  if (!chat) return
  await chat.sendMessage(message).catch((error) => {
    chatLog.error(`Failed to send chat reply: ${error instanceof Error ? error.message : error}`)
  })
}

// skip/pause/resume/stop share one global (not per-user) cooldown so two different moderators
// firing the same or different control commands back to back can't double up on the action
async function handleControlCommand(
  message: TwitchChatMessage,
  permission: TwitchChatPermission,
  cooldownSeconds: number,
  action: () => string
): Promise<void> {
  if (!hasPermission(message, permission)) return

  const now = Date.now()
  if (now - lastControlCommandAt < cooldownSeconds * 1000) {
    chatLog.log(`Ignored control command from ${message.displayName}: cooldown active`)
    return
  }
  lastControlCommandAt = now

  const reply = action()
  await replyInChat(reply)
}

async function handleChatMessage(message: TwitchChatMessage): Promise<void> {
  const commands = getConfig().twitch.chatCommands

  if (commands.now.enabled && matchesCommand(message.text, commands.now.command) && hasPermission(message, commands.now.permission)) {
    await replyInChat(buildNowPlayingMessage())
    return
  }

  if (commands.next.enabled && matchesCommand(message.text, commands.next.command) && hasPermission(message, commands.next.permission)) {
    await replyInChat(buildQueueMessage())
    return
  }

  if (commands.skip.enabled && matchesCommand(message.text, commands.skip.command)) {
    await handleControlCommand(message, commands.skip.permission, commands.controlCooldownSeconds, () => {
      skipCurrent()
      return buildSkipMessage(getState())
    })
    return
  }

  if (commands.pause.enabled && matchesCommand(message.text, commands.pause.command)) {
    await handleControlCommand(message, commands.pause.permission, commands.controlCooldownSeconds, () => {
      setPaused(true)
      return translateWithFallback('chat.paused', undefined, 'Player paused')
    })
    return
  }

  if (commands.resume.enabled && matchesCommand(message.text, commands.resume.command)) {
    await handleControlCommand(message, commands.resume.permission, commands.controlCooldownSeconds, () => {
      setPaused(false)
      return translateWithFallback('chat.resumed', undefined, 'Playback resumed')
    })
    return
  }

  if (commands.stop.enabled && matchesCommand(message.text, commands.stop.command)) {
    // StreamQueue has no separate "stop" state - pause is the existing equivalent (play/pause is all there is)
    await handleControlCommand(message, commands.stop.permission, commands.controlCooldownSeconds, () => {
      setPaused(true)
      return translateWithFallback('chat.paused', undefined, 'Player paused')
    })
    return
  }
}

async function startChat(): Promise<void> {
  if (!oauth || !client) return
  if (chat) return

  const userInfo = client.getCachedUserInfo()
  if (!userInfo) {
    chatLog.log('Twitch account not connected, chat will not start')
    return
  }

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
    chat = null
    chatLog.error(`Failed to start chat: ${error instanceof Error ? error.message : error}`)
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

  deviceAuthorizationPromise = oauth
    .pollForToken(device.device_code, device.interval, device.expires_in)
    .then(async () => {
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
    .catch((error) => {
      log.error(`Device authorization failed: ${error instanceof Error ? error.message : error}`)
      throw error
    })
    .finally(() => {
      deviceAuthorizationPromise = null
    })

  return device
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fulfillRedemption(redemption: TwitchChannelPointsRedemption, twitchClient: TwitchClient): Promise<void> {
  for (let attempt = 1; attempt <= REDEMPTION_RETRY_ATTEMPTS; attempt++) {
    try {
      await twitchClient.updateRedemptionStatus(redemption, 'FULFILLED')
      log.log(`Channel Points redemption fulfilled: ${redemption.id}`)
      return
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)

      if (attempt === REDEMPTION_RETRY_ATTEMPTS) {
        log.error(`Failed to fulfill redemption ${redemption.id} after ${attempt} attempts: ${reason}`)

        // Mark as failed after exhausting retry attempts
        try {
          await twitchClient.updateRedemptionStatus(redemption, 'CANCELED')
          log.log(`Channel Points redemption marked as failed/canceled: ${redemption.id}`)
        } catch (cancelError) {
          log.error(`Failed to mark redemption ${redemption.id} as failed: ${cancelError instanceof Error ? cancelError.message : cancelError}`)
        }
        return
      }

      const delay = REDEMPTION_RETRY_DELAY_MS * 2 ** (attempt - 1)

      log.error(`Failed to fulfill redemption ${redemption.id} (attempt ${attempt}/${REDEMPTION_RETRY_ATTEMPTS}): ${reason}. Retrying in ${delay}ms`)

      await wait(delay)
    }
  }
}

export function isDeviceAuthorizationPending(): boolean {
  return deviceAuthorizationPromise !== null
}

export async function disconnect(): Promise<void> {
  if (!oauth || !client) {
    log.log('Twitch integration not initialized, nothing to disconnect')
    return
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
  if (deviceAuthorizationPromise) {
    deviceAuthorizationPromise = null
    log.log('Device authorization cancelled due to disconnect')
  }

  oauth.clearTokenData()
  client.clearUserInfo()
  clearTwitchOAuthState()

  log.log('Twitch account disconnected')
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
export function _getClient(): TwitchClient | null {
  return client
}

// Export for testing purposes only
export function _getOAuth(): TwitchOAuth | null {
  return oauth
}

// Export for testing purposes only
export function _getEventSub(): TwitchEventSub | null {
  return eventSub
}

// Export for testing purposes only
export function _getChat(): TwitchChat | null {
  return chat
}

// Export for testing purposes only
export const _test = {
  hasPermission,
  matchesCommand,
  handleChatMessage,
  resetCooldown: () => {
    lastControlCommandAt = 0
  },
  setChat: (mock: TwitchChat | null) => {
    chat = mock
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
  lastControlCommandAt = 0
}
