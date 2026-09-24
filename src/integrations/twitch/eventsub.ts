import WebSocket from 'ws'
import { TwitchOAuth } from './oauth.js'
import type { EventSubMessage, TwitchChannelPointsRedemption } from './types.js'

const EVENTSUB_WS_URL = 'wss://eventsub.wss.twitch.tv/ws'
const CHANNEL_POINTS_REDEMPTION = 'channel.channel_points_custom_reward_redemption.add'
const EVENTSUB_VERSION = '1'
const RECONNECT_DELAY_MS = 5_000

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
  private stopped = false

  constructor(config: TwitchEventSubOptions) {
    this.config = config
  }

  async connect(): Promise<void> {
    if (this.socket) return

    this.stopped = false
    await this.openSocket(EVENTSUB_WS_URL)
  }

  async disconnect(): Promise<void> {
    this.stopped = true

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    const socket = this.socket
    this.socket = null
    this.sessionId = null
    if (!socket) return

    socket.removeAllListeners()
    socket.close()
    console.log('[TWITCH EVENTSUB] Disconnected')
  }

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  private openSocket(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url)
      let settled = false

      socket.once('open', () => {
        if (!settled) {
          settled = true
          resolve()
        }
      })

      socket.once('error', (error) => {
        if (!settled) {
          settled = true
          reject(error)
        }
      })

      socket.on('message', (data) => {
        void this.handleMessage(data.toString())
      })

      socket.on('close', () => {
        this.handleClose(socket)
      })

      socket.on('error', (error) => {
        console.error('[TWITCH EVENTSUB] WebSocket error:', error instanceof Error ? error.message : error)
      })

      this.socket = socket
    })
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
    if (!session) throw new Error('EventSub welcome message has no session')

    this.sessionId = session.id
    console.log(`[TWITCH EVENTSUB] Session connected: ${this.sessionId}`)
    await this.subscribeToChannelPoints()
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

    if (subscription.type === CHANNEL_POINTS_REDEMPTION) {
      await this.handleChannelPointsRedemption(message.payload.event)
    }
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

    console.log('[TWITCH EVENTSUB] Twitch requested reconnect')
    const oldSocket = this.socket

    try {
      await this.openSocket(reconnectUrl)
      oldSocket?.close()
      console.log('[TWITCH EVENTSUB] Reconnected')
    } catch (error) {
      console.error('[TWITCH EVENTSUB] Reconnect failed:', error instanceof Error ? error.message : error)
      this.scheduleReconnect()
    }
  }

  private handleRevocation(message: EventSubMessage): void {
    const subscription = message.payload.subscription
    console.warn(`[TWITCH EVENTSUB] Subscription revoked: ${subscription?.type ?? 'unknown'}`)
  }

  private handleClose(socket: WebSocket): void {
    if (this.socket !== socket) return

    this.socket = null
    this.sessionId = null

    if (this.stopped) return

    console.warn('[TWITCH EVENTSUB] Connection closed')
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null

      void this.connect().catch((error) => {
        console.error('[TWITCH EVENTSUB] Reconnect failed:', error instanceof Error ? error.message : error)
        this.scheduleReconnect()
      })
    }, RECONNECT_DELAY_MS)
  }
}

