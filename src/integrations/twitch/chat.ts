import WebSocket from 'ws'
import { TwitchOAuth } from './oauth.js'
import type { TwitchChatMessage } from './types.js'
import { createLogger } from '../../logger.js'

const log = createLogger('TWITCH CHAT')

const IRC_WS_URL = 'wss://irc-ws.chat.twitch.tv:443'
const INITIAL_RECONNECT_DELAY_MS = 5_000
const MAX_RECONNECT_DELAY_MS = 60_000
const MAX_RECONNECT_ATTEMPTS = 10
const JOIN_TIMEOUT_MS = 10_000
const PING_INTERVAL_MS = 4 * 60 * 1000

export type TwitchChatOptions = {
  oauth: TwitchOAuth
  channelLogin: string
  botLogin: string
  onMessage?: (message: TwitchChatMessage) => Promise<void> | void
}

function parseIrcLine(line: string): {
  tags: Record<string, string>
  prefix: string | null
  command: string
  params: string[]
  trailing: string | null
} {
  let rest = line
  const tags: Record<string, string> = {}

  if (rest.startsWith('@')) {
    const spaceIndex = rest.indexOf(' ')
    const tagString = spaceIndex === -1 ? rest.slice(1) : rest.slice(1, spaceIndex)
    rest = spaceIndex === -1 ? '' : rest.slice(spaceIndex + 1)

    for (const pair of tagString.split(';')) {
      const eq = pair.indexOf('=')
      if (eq === -1) continue
      tags[pair.slice(0, eq)] = pair.slice(eq + 1)
    }
  }

  let prefix: string | null = null
  if (rest.startsWith(':')) {
    const spaceIndex = rest.indexOf(' ')
    prefix = spaceIndex === -1 ? rest.slice(1) : rest.slice(1, spaceIndex)
    rest = spaceIndex === -1 ? '' : rest.slice(spaceIndex + 1)
  }

  let trailing: string | null = null
  const trailingIndex = rest.indexOf(' :')
  if (trailingIndex !== -1) {
    trailing = rest.slice(trailingIndex + 2)
    rest = rest.slice(0, trailingIndex)
  } else if (rest.startsWith(':')) {
    trailing = rest.slice(1)
    rest = ''
  }

  const params = rest.split(' ').filter(Boolean)
  const command = params.shift() ?? ''

  return { tags, prefix, command, params, trailing }
}

function hasBadge(badgesTag: string | undefined, badge: string): boolean {
  if (!badgesTag) return false
  return badgesTag.split(',').some((entry) => entry.split('/')[0] === badge)
}

export class TwitchChat {
  private readonly config: TwitchChatOptions
  private socket: WebSocket | null = null
  private joined = false
  private joinReady: Promise<void> | null = null
  private joinReadyResolve: (() => void) | null = null
  private joinReadyReject: ((error: Error) => void) | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private stopped = false
  private connecting = false
  private reconnectAttempts = 0
  private currentReconnectDelay = INITIAL_RECONNECT_DELAY_MS

  constructor(config: TwitchChatOptions) {
    this.config = config
  }

  async connect(): Promise<void> {
    if (this.stopped) {
      this.stopped = false
      this.reconnectAttempts = 0
      this.currentReconnectDelay = INITIAL_RECONNECT_DELAY_MS
    }
    if (this.isConnected() || this.connecting) return

    this.clearReconnectTimer()
    this.connecting = true

    try {
      await this.openSocket()
      await this.waitForJoin()
      this.startPingLoop()
    } finally {
      this.connecting = false
    }
  }

  async disconnect(): Promise<void> {
    this.stopped = true
    this.connecting = false
    this.clearReconnectTimer()
    this.clearPingLoop()
    this.clearJoinWait()

    const socket = this.socket
    this.socket = null
    this.joined = false

    if (!socket) return

    socket.removeAllListeners()
    socket.close()
    log.log('Disconnected')
  }

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN && this.joined
  }

  async sendMessage(text: string): Promise<void> {
    if (!this.isConnected() || !this.socket) {
      log.warn(`Cannot send message, not connected: ${text}`)
      return
    }

    this.socket.send(`PRIVMSG #${this.config.channelLogin} :${text}`)
  }

  private async openSocket(): Promise<void> {
    const accessToken = await this.config.oauth.getValidAccessToken()
    if (!accessToken) {
      throw new Error('Twitch account is not connected, cannot open chat connection')
    }

    this.clearJoinWait()
    this.joinReady = new Promise<void>((resolve, reject) => {
      this.joinReadyResolve = resolve
      this.joinReadyReject = reject
    })

    const socket = new WebSocket(IRC_WS_URL)
    this.socket = socket

    return new Promise((resolve, reject) => {
      let settled = false

      const fail = (error: unknown): void => {
        if (this.socket === socket) this.socket = null
        const normalized = this.toError(error)
        this.joinReadyReject?.(normalized)

        if (!settled) {
          settled = true
          reject(normalized)
        }
      }

      socket.once('open', () => {
        socket.send(`PASS oauth:${accessToken}`)
        socket.send(`NICK ${this.config.botLogin}`)
        socket.send('CAP REQ :twitch.tv/commands twitch.tv/tags')
        socket.send(`JOIN #${this.config.channelLogin}`)

        if (!settled) {
          settled = true
          resolve()
        }
      })

      socket.on('message', (data) => {
        this.handleData(data.toString())
      })

      socket.on('close', () => {
        this.handleClose(socket)
      })

      socket.on('error', (error) => {
        if (!settled) {
          fail(error)
          return
        }

        log.error(`WebSocket error: ${error instanceof Error ? error.message : error}`)
      })
    })
  }

  private async waitForJoin(): Promise<void> {
    if (this.joined) return
    if (!this.joinReady) throw new Error('Chat connection is not started')

    let timeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      timeout = null
      const error = new Error('Timed out waiting to join Twitch chat')
      this.joinReadyReject?.(error)

      const socket = this.socket
      this.socket = null
      this.joined = false
      socket?.close()
    }, JOIN_TIMEOUT_MS)

    try {
      await this.joinReady
    } finally {
      if (timeout) clearTimeout(timeout)
      timeout = null
    }
  }

  // Twitch IRC frames may contain more than one line, each separated by \r\n
  private handleData(raw: string): void {
    for (const line of raw.split('\r\n')) {
      if (line) this.handleLine(line)
    }
  }

  private handleLine(line: string): void {
    const { tags, prefix, command, params, trailing } = parseIrcLine(line)

    switch (command) {
      case 'PING':
        this.socket?.send(`PONG :${trailing ?? ''}`)
        return
      case '001':
        // Successful PASS/NICK auth (numeric welcome reply). Actual readiness still waits for JOIN
        // below, since a bad channel name would otherwise be reported as connected
        return
      case 'JOIN':
        if (prefix?.split('!')[0] === this.config.botLogin && params[0] === `#${this.config.channelLogin}`) {
          this.joined = true
          log.log(`Joined channel #${this.config.channelLogin}`)
          this.joinReadyResolve?.()
          this.joinReadyResolve = null
          this.joinReadyReject = null
        }
        return
      case 'NOTICE':
        // Auth failures land here (e.g. "Login authentication failed", "Improperly formatted auth")
        if (!this.joined) {
          const error = new Error(trailing || 'Twitch chat authentication failed')
          this.joinReadyReject?.(error)
        }
        log.warn(`NOTICE: ${trailing ?? ''}`)
        return
      case 'PRIVMSG':
        this.handlePrivmsg(tags, prefix, params, trailing)
        return
      default:
        return
    }
  }

  private handlePrivmsg(tags: Record<string, string>, prefix: string | null, params: string[], trailing: string | null): void {
    if (!trailing) return
    if (params[0] !== `#${this.config.channelLogin}`) return

    const userLogin = prefix?.split('!')[0] ?? ''
    const displayName = tags['display-name'] || userLogin
    const isBroadcaster = hasBadge(tags.badges, 'broadcaster')
    const isModerator = tags.mod === '1' || hasBadge(tags.badges, 'moderator') || isBroadcaster

    const message: TwitchChatMessage = {
      channel: this.config.channelLogin,
      displayName,
      userLogin,
      text: trailing,
      isModerator,
      isBroadcaster
    }

    log.log(`${message.displayName}: ${message.text}`)

    void Promise.resolve(this.config.onMessage?.(message)).catch((error) => {
      log.error(`Chat message handler failed: ${error instanceof Error ? error.message : error}`)
    })
  }

  private handleClose(socket: WebSocket): void {
    if (this.socket !== socket) return

    this.socket = null
    this.joined = false
    this.clearPingLoop()
    this.clearJoinWait()

    if (this.stopped) return

    log.warn('Connection closed')
    this.scheduleReconnect()
  }

  private startPingLoop(): void {
    this.clearPingLoop()
    // Twitch pings us periodically already, but sending our own keeps the connection alive
    // through intermediary proxies/load balancers that might otherwise drop an idle socket
    this.pingTimer = setInterval(() => {
      this.socket?.send('PING :tmi.twitch.tv')
    }, PING_INTERVAL_MS)
  }

  private clearPingLoop(): void {
    if (!this.pingTimer) return
    clearInterval(this.pingTimer)
    this.pingTimer = null
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer || this.connecting) return

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      log.error(`Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached, giving up`)
      return
    }

    this.reconnectAttempts++
    const delay = this.currentReconnectDelay

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null

      void this.connect().catch((error) => {
        log.error(`Reconnect failed (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}): ${error instanceof Error ? error.message : error}`)

        this.currentReconnectDelay = Math.min(this.currentReconnectDelay * 2, MAX_RECONNECT_DELAY_MS)
        this.scheduleReconnect()
      })
    }, delay)
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private clearJoinWait(): void {
    this.joinReadyResolve = null
    this.joinReadyReject = null
    this.joinReady = null
  }

  private toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error))
  }
}
