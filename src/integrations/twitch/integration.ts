import { createLogger } from '../../logger.js'
import { AppError } from '../../types.js'
import { updateTwitchOAuthState, clearTwitchOAuthState, getSecrets, getPublicSecretsView } from '../../secrets.js'
import { detachChannelPointsRedemptions } from '../../queue.js'
import { registerRedemptionHandler, type RedemptionOutcome } from '../../finish.js'
import type { QueueItem } from '../../types.js'
import { TwitchOAuth } from './oauth.js'
import { TwitchClient } from './client.js'
import { TwitchEventSub } from './eventsub.js'
import { TwitchChat } from './chat.js'
import { DeviceAuthorization } from './device-auth.js'
import { RedemptionHandler } from './redemptions.js'
import { ChatCommands } from './chat-commands.js'
import { ChatReplier, buildRedemptionAcceptedMessage } from './chat-replies.js'
import { getTwitchConfig } from './config.js'
import type {
  TwitchAuthConfig,
  TwitchDeviceCodeResponse,
  TwitchUserInfo,
  TwitchChatMessage
} from './types.js'

export type TwitchHealth = {
  auth: 'ok' | 'reauthorize'
  eventSub: boolean
  chat: boolean
}

const log = createLogger('TWITCH')
const chatLog = createLogger('TWITCH CHAT')

export type TwitchDeps = {
  queue: {
    requestSong: (query: string, userName: string, skipValidation: boolean, redemption: { id: string; rewardId: string; userName: string }) => Promise<{ outcome: string; added?: { song: { title: string }; started: boolean; position: number }; reason?: any }>
    setPaused: (paused: boolean) => void
    detachChannelPointsRedemptions: () => number
  }
  player: {
    getState: () => { current: { title: string; requestedBy: string } | null; queue: Array<{ title: string }>; isPaused: boolean }
    skipCurrent: () => void
  }
  registerRedemptionHandler: (handler: (tracked: NonNullable<QueueItem['channelPointsRedemption']>, outcome: RedemptionOutcome) => void) => void
  translate: (key: string, params?: Record<string, string | number>, fallback?: string) => string
  createSocketClients?: () => { eventSub: TwitchEventSub; chat: TwitchChat }
}

export interface TwitchIntegration {
  start(): Promise<void>
  stop(): Promise<void>
  startDeviceAuthorization(): Promise<TwitchDeviceCodeResponse>
  disconnect(): Promise<void>
  refreshConnection(): Promise<TwitchUserInfo>
  getHealth(): TwitchHealth
  getClient(): TwitchClient | null
}

class TwitchIntegrationImpl implements TwitchIntegration {
  private oauth: TwitchOAuth
  private client: TwitchClient
  private eventSub: TwitchEventSub | null = null
  private chat: TwitchChat | null = null
  private deviceAuth: DeviceAuthorization
  private redemptionHandler: RedemptionHandler | null = null
  private chatCommands: ChatCommands | null = null
  private chatReplier: ChatReplier | null = null
  private deps: TwitchDeps

  constructor(config: TwitchAuthConfig, deps: TwitchDeps) {
    this.oauth = new TwitchOAuth({
      clientId: config.clientId,
      scopes: config.scopes,
      onTokenUpdated: (tokenData) => {
        updateTwitchOAuthState({ tokenData })
      }
    })
    this.client = new TwitchClient(this.oauth)
    this.deps = deps

    this.deviceAuth = new DeviceAuthorization(this.oauth, async () => {
      const userInfo = await this.client.getUserInfo()
      updateTwitchOAuthState({
        userInfo,
        connectedAt: Date.now()
      })
      await this.start()
      return userInfo
    })

    this.restoreState()

    this.deps.registerRedemptionHandler((tracked, outcome) => {
      const redemption = {
        id: tracked.id,
        user_name: tracked.userName,
        reward: { id: tracked.rewardId }
      } as any

      if (outcome.status === 'failed') {
        void this.redemptionHandler?.cancel(redemption, outcome.reason)
        return
      }

      if (!getTwitchConfig().autoFulfillRedemptions) {
        log.log(`Redemption ${tracked.id} finished playback, left unfulfilled (auto-fulfill disabled)`)
        return
      }

      void this.redemptionHandler?.fulfill(redemption)
    })
  }

  private restoreState(): void {
    const secrets = getSecrets()

    if (secrets.twitch.tokenData) {
      this.oauth.setTokenData(secrets.twitch.tokenData)
      log.log('Restored Twitch token data from storage')
    }

    if (secrets.twitch.userInfo) {
      this.client.setCachedUserInfo(secrets.twitch.userInfo)
      log.log('Restored Twitch user info from storage')
    }
  }

  async start(): Promise<void> {
    await this.startEventSub()
    await this.startChat()
  }

  async stop(): Promise<void> {
    if (this.eventSub) {
      await this.eventSub.disconnect()
      this.eventSub = null
    }

    if (this.chat) {
      await this.chat.disconnect()
      this.chat = null
    }

    this.deviceAuth.cancel()
    this.chatReplier?.clearChatStart()
  }

  async startDeviceAuthorization(): Promise<TwitchDeviceCodeResponse> {
    if (getPublicSecretsView().twitch.connected) {
      throw new AppError('TWITCH_AUTH_ERROR', 'Twitch account is already connected')
    }

    return this.deviceAuth.start()
  }

  async disconnect(): Promise<void> {
    await this.stop()

    const detached = this.deps.queue.detachChannelPointsRedemptions()
    if (detached > 0) log.warn(`${detached} queued redemption(s) stay UNFULFILLED on Twitch: fulfill or refund them in the rewards queue`)

    await this.oauth.revokeTokens()

    this.oauth.clearTokenData()
    this.client.clearUserInfo()
    clearTwitchOAuthState()

    log.log('Twitch account disconnected')
  }

  async refreshConnection(): Promise<TwitchUserInfo> {
    try {
      const userInfo = await this.client.getUserInfo()

      updateTwitchOAuthState({ userInfo })

      await this.start()

      log.log('Twitch connection refreshed')
      return userInfo
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      log.error(`Failed to refresh connection: ${reason}`)
      throw new AppError('TWITCH_REFRESH_ERROR', reason)
    }
  }

  getHealth(): TwitchHealth {
    return {
      auth: this.oauth.needsReauthorization() ? 'reauthorize' : 'ok',
      eventSub: this.eventSub?.isConnected() ?? false,
      chat: this.chat?.isConnected() ?? false
    }
  }

  getClient(): TwitchClient | null {
    return this.client
  }

  private async startEventSub(): Promise<void> {
    if (this.eventSub) {
      if (!this.eventSub.isConnected()) await this.eventSub.connect().catch(() => this.eventSub?.retryInBackground())
      return
    }

    if (!this.client.getCachedUserInfo()) {
      log.log('Twitch account not connected, EventSub will not start')
      return
    }

    if (!this.oauth.getConfig().clientId) {
      log.log('Twitch client ID not configured, EventSub will not start')
      return
    }

    const socketClients = this.deps.createSocketClients?.()
    this.eventSub = socketClients?.eventSub ?? new TwitchEventSub({
      client: this.client,
      onChannelPointsRedemption: (event) => this.handleChannelPointsRedemption(event)
    })

    try {
      await this.eventSub.connect()
      log.log('Twitch EventSub connected')
    } catch (error) {
      log.error(`Failed to start EventSub, will keep retrying: ${error instanceof Error ? error.message : error}`)
      this.eventSub.retryInBackground()
    }
  }

  private async startChat(): Promise<void> {
    const userInfo = this.client.getCachedUserInfo()
    if (!userInfo) {
      chatLog.log('Twitch account not connected, chat will not start')
      return
    }

    if (this.chat) {
      if (!this.chat.isConnected()) await this.chat.connect().catch(() => this.chat?.retryInBackground())
      return
    }

    const socketClients = this.deps.createSocketClients?.()
    this.chat = socketClients?.chat ?? new TwitchChat({
      oauth: this.oauth,
      channelLogin: userInfo.login,
      botLogin: userInfo.login,
      onMessage: (message) => this.handleChatMessage(message)
    })

    this.chatReplier = new ChatReplier(
      (message) => this.chat!.sendMessage(message),
      () => this.chat!.isConnected()
    )

    try {
      await this.chat.connect()
      chatLog.log('Twitch chat connected')
    } catch (error) {
      chatLog.error(`Failed to start chat, will keep retrying: ${error instanceof Error ? error.message : error}`)
      this.chat.retryInBackground()
    }
  }

  private async handleChannelPointsRedemption(event: any): Promise<void> {
    if (!this.redemptionHandler) {
      this.redemptionHandler = new RedemptionHandler(
        this.client,
        (message) => this.chatReplier?.reply(message) ?? Promise.resolve(),
        {
          requestSong: this.deps.queue.requestSong,
          buildAcceptedMessage: buildRedemptionAcceptedMessage
        }
      )
    }

    const configuredRewardId = getTwitchConfig().channelPointsRewardId
    await this.redemptionHandler.handle(event, configuredRewardId)
  }

  private async handleChatMessage(message: TwitchChatMessage): Promise<void> {
    if (!this.chatCommands) {
      this.chatCommands = new ChatCommands(
        {
          buildNowPlayingMessage: () => {
            const state = this.deps.player.getState()
            if (!state.current) {
              return this.deps.translate('chat.nothingPlaying', undefined, 'Nothing is playing right now')
            }
            const base = this.deps.translate(
              'chat.nowPlayingWithRequester',
              { title: state.current.title, requestedBy: state.current.requestedBy },
              `Now playing: ${state.current.title} (requested by ${state.current.requestedBy})`
            )
            const pausedSuffix = state.isPaused ? this.deps.translate('chat.pausedSuffix', undefined, ' (paused)') : ''
            return base + pausedSuffix
          },
          buildQueueMessage: () => {
            const state = this.deps.player.getState()
            if (state.queue.length === 0) {
              return this.deps.translate('chat.queueEmpty', undefined, 'The queue is empty')
            }
            const maxShown = 4
            const list = state.queue
              .slice(0, maxShown)
              .map((item, i) => `${i + 1}. ${item.title}`)
              .join(' | ')
            const base = this.deps.translate('chat.queueList', { count: state.queue.length, list }, `Queue [${state.queue.length}]: ${list}`)
            const more =
              state.queue.length > maxShown
                ? this.deps.translate('chat.queueMore', { count: state.queue.length - maxShown }, ` [+${state.queue.length - maxShown}]`)
                : ''
            return base + more
          },
          skipCurrent: this.deps.player.skipCurrent,
          getState: this.deps.player.getState,
          setPaused: this.deps.queue.setPaused,
          translate: this.deps.translate as any
        },
        (message) => this.chatReplier?.reply(message) ?? Promise.resolve()
      )
    }

    const commands = getTwitchConfig().chatCommands
    await this.chatCommands.handle(message, commands)
  }
}

export function createTwitchIntegration(options: { clientId: string }, deps?: Partial<TwitchDeps>): TwitchIntegration {
  const fullDeps: TwitchDeps = {
    queue: deps?.queue ?? {
      requestSong: async () => ({ outcome: 'not-found' }),
      setPaused: () => {},
      detachChannelPointsRedemptions: () => 0
    },
    player: deps?.player ?? {
      getState: () => ({ current: null, queue: [], isPaused: false }),
      skipCurrent: () => {}
    },
    registerRedemptionHandler: deps?.registerRedemptionHandler ?? (() => {}),
    translate: deps?.translate ?? ((key: string, _params: any, fallback?: string) => fallback ?? key),
    createSocketClients: deps?.createSocketClients
  }

  return new TwitchIntegrationImpl({ clientId: options.clientId, scopes: [] }, fullDeps)
}
