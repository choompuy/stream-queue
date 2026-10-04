import { CHANNEL_POINTS_REDEMPTION, type TwitchClient } from './client.js'
import { ReconnectingSocket, closeQuietly } from './socket.js'
import type { EventSubMessage, TwitchChannelPointsRedemption } from './types.js'
import { createLogger } from '../../logger.js'

const log = createLogger('TWITCH EVENTSUB')

export type TwitchEventSubOptions = {
  client: TwitchClient
  onChannelPointsRedemption?: (event: TwitchChannelPointsRedemption) => Promise<void> | void
}

export class TwitchEventSub extends ReconnectingSocket {
  protected readonly log = log
  protected readonly url = 'wss://eventsub.wss.twitch.tv/ws'
  protected readonly readyName = 'the EventSub session welcome'
  private readonly config: TwitchEventSubOptions
  private isReconnect = false
  private recentMessageIds: string[] = []
  private static readonly MAX_RECENT_MESSAGE_IDS = 100

  constructor(config: TwitchEventSubOptions) {
    super()
    this.config = config
  }

  async connect(): Promise<void> {
    this.isReconnect = false
    await super.connect()
  }

  protected async onMessage(rawMessage: string): Promise<void> {
    let message: EventSubMessage

    try {
      message = JSON.parse(rawMessage) as EventSubMessage
    } catch (error) {
      log.error(`Failed to parse message: ${error instanceof Error ? error.message : error}`)
      return
    }

    switch (message.metadata.message_type) {
      case 'session_welcome':
        await this.handleWelcome(message)
        return
      case 'session_keepalive':
        return
      case 'notification':
        await this.handleNotification(message)
        return
      case 'session_reconnect':
        await this.handleReconnect(message)
        return
      case 'revocation':
        this.handleRevocation(message)
        return
      default:
        log.warn(`Unknown message type: ${message.metadata.message_type}`)
    }
  }

  private async handleWelcome(message: EventSubMessage): Promise<void> {
    const sessionId = message.payload.session?.id

    if (!sessionId) {
      this.abort(new Error('EventSub welcome message has no session'))
      return
    }

    log.log(`Session connected: ${sessionId}`)

    if (this.isReconnect) {
      log.log('Reconnected session: subscription carries over, not re-subscribing')
      this.isReconnect = false
      this.markReady()
      this.watchKeepalive(message)
      return
    }

    try {
      await this.config.client.subscribeToRedemptions(sessionId)
      log.log('Subscribed to Channel Points redemptions')
      this.markReady()
      this.watchKeepalive(message)
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error))
      this.abort(normalized)
      throw normalized
    }
  }

  // Twitch promises a message (a keepalive at the least) within keepalive_timeout_seconds; with a margin, silence means a dead session
  private watchKeepalive(welcome: EventSubMessage): void {
    const seconds = welcome.payload.session?.keepalive_timeout_seconds
    const timeoutSeconds = typeof seconds === 'number' && seconds > 0 ? seconds : 10
    this.startWatchdog(Math.max(timeoutSeconds * 1.5, 15) * 1000)
  }

  protected canReconnect(): boolean {
    return !this.config.client.needsReauthorization()
  }

  private async handleNotification(message: EventSubMessage): Promise<void> {
    const subscription = message.payload.subscription
    if (!subscription) {
      log.warn('Notification has no subscription')
      return
    }

    if (subscription.type !== CHANNEL_POINTS_REDEMPTION) return

    const messageId = message.metadata.message_id
    if (this.recentMessageIds.includes(messageId)) {
      log.log(`Ignoring redelivered notification: ${messageId}`)
      return
    }

    this.recentMessageIds.push(messageId)
    if (this.recentMessageIds.length > TwitchEventSub.MAX_RECENT_MESSAGE_IDS) {
      this.recentMessageIds.shift()
    }

    await this.handleChannelPointsRedemption(message.payload.event)
  }

  private async handleChannelPointsRedemption(event: unknown): Promise<void> {
    if (!event || typeof event !== 'object') {
      log.warn('Invalid Channel Points event')
      return
    }

    const redemption = event as TwitchChannelPointsRedemption
    log.log(`Channel Points redemption: ${redemption.reward.title} by ${redemption.user_name}`)
    await this.config.onChannelPointsRedemption?.(redemption)
  }

  private async handleReconnect(message: EventSubMessage): Promise<void> {
    const reconnectUrl = message.payload.session?.reconnect_url
    if (!reconnectUrl) {
      log.error('Reconnect message has no URL')
      return
    }

    const oldSocket = this.socket
    this.isReconnect = true
    log.log('Twitch requested reconnect')

    try {
      await this.open(reconnectUrl)
      await this.waitReady()
      log.log('Reconnected')
    } catch (error) {
      log.error(`Reconnect failed: ${error instanceof Error ? error.message : error}`)
      this.isReconnect = false
      this.scheduleReconnect()
    } finally {
      if (oldSocket !== this.socket) closeQuietly(oldSocket)
    }
  }

  private handleRevocation(message: EventSubMessage): void {
    const subscription = message.payload.subscription
    log.warn(`Subscription revoked: ${subscription?.type ?? 'unknown'} (${subscription?.status ?? 'unknown'})`)

    this.restart()
  }
}
