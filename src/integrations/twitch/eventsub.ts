import WebSocket from 'ws'
import { TwitchOAuth } from './oauth.js'
import type { EventSubMessage, TwitchChannelPointsRedemption } from './types.js'

const EVENTSUB_WS_URL = 'wss://eventsub.wss.twitch.tv/ws'
const CHANNEL_POINTS_REDEMPTION = 'channel.channel_points_custom_reward_redemption.add'
const EVENTSUB_VERSION = '1'
const RECONNECT_DELAY_MS = 5_000
const SESSION_TIMEOUT_MS = 10_000

export type TwitchEventSubOptions = {
  clientId: string
  oauth: TwitchOAuth
  broadcasterUserId: string
  onChannelPointsRedemption?: (event: TwitchChannelPointsRedemption) => Promise<void> | void
}

export class TwitchEventSub {
  private readonly config: TwitchEventSubOptions
  private socket: WebSocket | null = null
  private sessionId: string | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private sessionReady: Promise<void> | null = null
  private sessionReadyResolve: (() => void) | null = null
  private sessionReadyReject: ((error: Error) => void) | null = null
  private stopped = false
  private connecting = false

  constructor(config: TwitchEventSubOptions) {
    this.config = config
  }

  async connect(): Promise<void> {
    if (this.stopped) this.stopped = false
    if (this.isConnected() || this.connecting) return

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    this.connecting = true

    try {
      await this.openSocket(EVENTSUB_WS_URL)
      await this.waitForSession()
    } finally {
      this.connecting = false
    }
  }

  async disconnect(): Promise<void> {
    this.stopped = true
    this.connecting = false
    this.clearReconnectTimer()
    this.clearSessionWait()

    const socket = this.socket
    this.socket = null
    this.sessionId = null

    if (!socket) return

    socket.removeAllListeners()
    socket.close()
    console.log('[TWITCH EVENTSUB] Disconnected')
  }

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN && this.sessionId !== null
  }

  private openSocket(url: string): Promise<void> {
    this.clearSessionWait()

    this.sessionReady = new Promise<void>((resolve, reject) => {
      this.sessionReadyResolve = resolve
      this.sessionReadyReject = reject
    })

    const socket = new WebSocket(url)
    this.socket = socket

    return new Promise((resolve, reject) => {
      let settled = false

      const fail = (error: unknown): void => {
        if (this.socket === socket) this.socket = null
        if (this.sessionReadyReject) this.sessionReadyReject(this.toError(error))

        if (!settled) {
          settled = true
          reject(this.toError(error))
        }
      }

      socket.once('open', () => {
        if (!settled) {
          settled = true
          resolve()
        }
      })

      socket.on('message', (data) => {
        void this.handleMessage(data.toString()).catch((error) => {
          console.error('[TWITCH EVENTSUB] Failed to handle message:', error instanceof Error ? error.message : error)
        })
      })

      socket.on('close', () => {
        this.handleClose(socket)
      })

      socket.on('error', (error) => {
        if (!settled) {
          fail(error)
          return
        }

        console.error('[TWITCH EVENTSUB] WebSocket error:', error instanceof Error ? error.message : error)
      })
    })
  }

  private async waitForSession(): Promise<void> {
    if (this.sessionId) return
    if (!this.sessionReady) throw new Error('EventSub session initialization is not started')

    let timeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      timeout = null
      this.sessionReadyReject?.(new Error('Timed out waiting for EventSub session welcome'))
    }, SESSION_TIMEOUT_MS)

    try {
      await this.sessionReady
    } finally {
      if (timeout) clearTimeout(timeout)
      timeout = null
    }
  }

  private async handleMessage(rawMessage: string): Promise<void> {
    let message: EventSubMessage

    try {
      message = JSON.parse(rawMessage) as EventSubMessage
    } catch (error) {
      console.error('[TWITCH EVENTSUB] Failed to parse message:', error instanceof Error ? error.message : error)
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
        console.warn(`[TWITCH EVENTSUB] Unknown message type: ${message.metadata.message_type}`)
    }
  }

  private async handleWelcome(message: EventSubMessage): Promise<void> {
    const session = message.payload.session

    if (!session?.id) {
      const error = new Error('EventSub welcome message has no session')
      this.sessionReadyReject?.(error)
      return
    }

    this.sessionId = session.id
    console.log(`[TWITCH EVENTSUB] Session connected: ${this.sessionId}`)

    try {
      await this.subscribeToChannelPoints()
      this.sessionReadyResolve?.()
    } catch (error) {
      const normalizedError = this.toError(error)
      this.sessionReadyReject?.(normalizedError)

      const socket = this.socket
      this.socket = null
      this.sessionId = null
      socket?.close()

      throw normalizedError
    } finally {
      this.sessionReadyResolve = null
      this.sessionReadyReject = null
    }
  }

  private async subscribeToChannelPoints(): Promise<void> {
    if (!this.sessionId) throw new Error('EventSub session is not initialized')

    const accessToken = await this.config.oauth.getValidAccessToken()
    if (!accessToken) throw new Error('No valid Twitch access token available')

    const response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Client-Id': this.config.clientId,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: CHANNEL_POINTS_REDEMPTION,
        version: EVENTSUB_VERSION,
        condition: {
          broadcaster_user_id: this.config.broadcasterUserId
        },
        transport: {
          method: 'websocket',
          session_id: this.sessionId
        }
      })
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Failed to subscribe to Channel Points: HTTP ${response.status} ${body}`)
    }

    console.log('[TWITCH EVENTSUB] Subscribed to Channel Points redemptions')
  }

  private async handleNotification(message: EventSubMessage): Promise<void> {
    const subscription = message.payload.subscription
    if (!subscription) {
      console.warn('[TWITCH EVENTSUB] Notification has no subscription')
      return
    }

    if (subscription.type !== CHANNEL_POINTS_REDEMPTION) return

    await this.handleChannelPointsRedemption(message.payload.event)
  }

  private async handleChannelPointsRedemption(event: unknown): Promise<void> {
    if (!event || typeof event !== 'object') {
      console.warn('[TWITCH EVENTSUB] Invalid Channel Points event')
      return
    }

    const redemption = event as TwitchChannelPointsRedemption
    console.log(`[TWITCH EVENTSUB] Channel Points redemption: ${redemption.reward.title} by ${redemption.user_name}`)
    await this.config.onChannelPointsRedemption?.(redemption)
  }

  private async handleReconnect(message: EventSubMessage): Promise<void> {
    const reconnectUrl = message.payload.session?.reconnect_url
    if (!reconnectUrl) {
      console.error('[TWITCH EVENTSUB] Reconnect message has no URL')
      return
    }

    const oldSocket = this.socket
    this.sessionId = null
    console.log('[TWITCH EVENTSUB] Twitch requested reconnect')

    try {
      await this.openSocket(reconnectUrl)
      await this.waitForSession()
      oldSocket?.close()
      console.log('[TWITCH EVENTSUB] Reconnected')
    } catch (error) {
      console.error('[TWITCH EVENTSUB] Reconnect failed:', error instanceof Error ? error.message : error)
      this.scheduleReconnect()
    }
  }

  private handleRevocation(message: EventSubMessage): void {
    const subscription = message.payload.subscription

    console.warn(`[TWITCH EVENTSUB] Subscription revoked: ${subscription?.type ?? 'unknown'} (${subscription?.status ?? 'unknown'})`)

    this.stopped = true
    this.clearReconnectTimer()
    this.clearSessionWait()

    const socket = this.socket
    this.socket = null
    this.sessionId = null
    socket?.close()
  }

  private handleClose(socket: WebSocket): void {
    if (this.socket !== socket) return

    this.socket = null
    this.sessionId = null
    this.clearSessionWait()

    if (this.stopped) return

    console.warn('[TWITCH EVENTSUB] Connection closed')
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer || this.connecting) return

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null

      void this.connect().catch((error) => {
        console.error('[TWITCH EVENTSUB] Reconnect failed:', error instanceof Error ? error.message : error)
        this.scheduleReconnect()
      })
    }, RECONNECT_DELAY_MS)
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return

    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private clearSessionWait(): void {
    this.sessionReadyResolve = null
    this.sessionReadyReject = null
    this.sessionReady = null
  }

  private toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error))
  }
}
