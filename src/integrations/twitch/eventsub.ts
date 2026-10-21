import type WebSocket from 'ws'
import { CHANNEL_POINTS_REDEMPTION, type TwitchClient } from './client.js'
import { ReconnectingSocket, closeQuietly } from './socket.js'
import type { EventSubMessage, TwitchChannelPointsRedemption } from './types.js'
import { createLogger, describeError } from '../../logger.js'
import { logActivity, updateActivityReasonParams } from '../../activity.js'
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
  // the streamer can only learn it from the journal. A real outage leaves a line there as soon as it crosses the
  // threshold - with the minutes known at that moment - and the line learns the real length when the connection
  // returns, still as one line; a blip (and Twitch's own seamless reconnect request) stays out of the journal
  private hadReadySession = false
  private connectionLostAt: number | null = null
  private journalTimer: ReturnType<typeof setTimeout> | null = null
  private journalEntryAt: number | null = null
  protected journalAfterMs = 60_000

  protected markReady(): void {
    super.markReady()
    this.hadReadySession = true
  }

  protected onOpen(_socket: WebSocket): void {
    // the connection is back: whatever outage it ended, the alarm is not needed anymore. The line the threshold
    // already wrote says how long the outage was at that moment; the recovery knows the real length and
    // corrects that same line instead of writing a second one
    if (this.journalTimer) {
      clearTimeout(this.journalTimer)
      this.journalTimer = null
    }
    if (this.connectionLostAt !== null && this.journalEntryAt !== null) {
      updateActivityReasonParams(this.journalEntryAt, { minutes: Math.round((Date.now() - this.connectionLostAt) / 60_000) })
    }
    this.journalEntryAt = null
    this.connectionLostAt = null
  }

  protected onClosed(): void {
    // an intentional stop loses nothing (stopped is set before the teardown): no alarm afterwards
    if (this.stopped) return

    // only a session that was ready could lose something; the retries during an outage do not re-arm the alarm
    const lostAt = this.hadReadySession ? Date.now() : null
    this.hadReadySession = false
    if (lostAt === null) return

    this.connectionLostAt = lostAt
    // the journal line is written when the outage crosses the threshold, not when it ends: a long one must be
    // visible even if the connection never comes back, and its minutes are the ones known at that moment -
    // a blip cancels the timer in onOpen and stays unrecorded
    if (this.journalTimer) clearTimeout(this.journalTimer)
    this.journalTimer = setTimeout(() => {
      this.journalTimer = null
      this.journalEntryAt = logActivity({
        requestedBy: 'Twitch',
        query: 'Twitch',
        title: null,
        videoId: null,
        status: 'failed',
        reasonCode: 'TWITCH_CONNECTION_LOST',
        reasonParams: { minutes: Math.round((Date.now() - lostAt) / 60_000) }
      })
    }, this.journalAfterMs)
  }

  async disconnect(): Promise<void> {
    // an intentional stop is not an outage: whatever alarm survived from it is cancelled here, together with
    // the correction a later recovery would have written
    if (this.journalTimer) {
      clearTimeout(this.journalTimer)
      this.journalTimer = null
    }
    this.journalEntryAt = null
    this.connectionLostAt = null
    await super.disconnect()
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
      // no log line here: the rejected connect() reaches the caller, and connectOrRetry() reports the same
      // failure once, with the retry plan - two error lines for one subscription refusal is a duplicate
      const normalized = normalizeTwitchError(error)
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
