import type WebSocket from 'ws'
import { CHANNEL_POINTS_REDEMPTION, type TwitchClient } from './client.js'
import { ReconnectingSocket, closeQuietly } from './socket.js'
import type { EventSubMessage, TwitchChannelPointsRedemption } from './types.js'
import { createLogger, describeError } from '../../logger.js'
import { logActivity } from '../../activity.js'
import { normalizeTwitchError } from './error.js'

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

  // A dropped session loses whatever Twitch sent while it was down (a laptop asleep, a changed network), and
  // the streamer can only learn it from the journal. A real outage leaves a line there; a blip (and Twitch's
  // own seamless reconnect request) stays below the threshold and out of the journal
  private hadReadySession = false
  private connectionLostAt: number | null = null
  protected journalAfterMs = 60_000

  protected markReady(): void {
    super.markReady()
    this.hadReadySession = true
  }

  protected onOpen(_socket: WebSocket): void {
    const lostAt = this.connectionLostAt
    this.connectionLostAt = null
    if (lostAt === null) return

    const downMs = Date.now() - lostAt
    if (downMs < this.journalAfterMs) return

    logActivity({
      requestedBy: 'Twitch',
      query: 'Twitch',
      title: null,
      videoId: null,
      status: 'failed',
      reasonCode: 'TWITCH_CONNECTION_LOST',
      reasonParams: { minutes: Math.round(downMs / 60_000) }
    })
  }

  protected onClosed(): void {
    // an intentional stop loses nothing (stopped is set before the teardown): no alarm afterwards
    if (this.stopped) return
    if (this.hadReadySession) this.connectionLostAt = Date.now()
    this.hadReadySession = false
  }

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
      log.error(`Failed to parse message: ${describeError(error)}`)
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

    log.info(`Session connected: ${sessionId}`)

    if (this.isReconnect) {
      log.info('Reconnected session: subscription carries over, not re-subscribing')
      this.isReconnect = false
      this.markReady()
      this.watchKeepalive(message)
      return
    }

    try {
      await this.config.client.subscribeToRedemptions(sessionId)
      log.info('Subscribed to Channel Points redemptions')
      this.markReady()
      this.watchKeepalive(message)
    } catch (error) {
      const normalized = normalizeTwitchError(error)
      log.error(`EventSub subscription failed: ${describeError(normalized)}`)
      this.abort(normalized)
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
      log.info(`Ignoring redelivered notification: ${messageId}`)
      return
    }

    this.recentMessageIds.push(messageId)
    if (this.recentMessageIds.length > TwitchEventSub.MAX_RECENT_MESSAGE_IDS) {
      this.recentMessageIds.shift()
    }

    await this.handleChannelPointsRedemption(message.payload.event)
  }

  private async handleChannelPointsRedemption(event: unknown): Promise<void> {
    const redemption = event as TwitchChannelPointsRedemption | null
    if (!redemption || typeof redemption !== 'object' || !redemption.id || !redemption.reward?.id) {
      log.warn('Invalid Channel Points event')
      return
    }

    // the viewer and the reward are logged by the handler once the reward is known to be the configured one
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
    log.info('Twitch requested reconnect')

    try {
      await this.open(reconnectUrl)
      await this.waitReady()
      log.info('Reconnected')
    } catch (error) {
      log.error(`Reconnect failed: ${describeError(error)}`)
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
