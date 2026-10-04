import type WebSocket from 'ws'
import { TwitchOAuth } from './oauth.js'
import { ReconnectingSocket } from './socket.js'
import type { TwitchChatMessage } from './types.js'
import { createLogger } from '../../logger.js'

const log = createLogger('TWITCH CHAT')

const IRC_WS_URL = 'wss://irc-ws.chat.twitch.tv:443'
const PING_INTERVAL_MS = 2 * 60 * 1000
// Twitch answers our PING at once: no data at all for this long means the connection is dead
const WATCHDOG_MS = PING_INTERVAL_MS + 60_000
const MAX_MESSAGE_LENGTH = 500

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

export class TwitchChat extends ReconnectingSocket {
  protected readonly log = log
  protected readonly url = IRC_WS_URL
  protected readonly readyName = 'the chat join'
  private readonly config: TwitchChatOptions
  private accessToken = ''
  private pingTimer: ReturnType<typeof setInterval> | null = null

  constructor(config: TwitchChatOptions) {
    super()
    this.config = config
  }

  async sendMessage(text: string): Promise<void> {
    if (!this.isConnected() || !this.socket) {
      log.warn(`Cannot send message, not connected: ${text}`)
      return
    }

    // a line break would end the IRC command and let the rest be read as a new one; Twitch drops anything over 500 characters
    const clean = text
      .replace(/[\r\n]+/g, ' ')
      .trim()
      .slice(0, MAX_MESSAGE_LENGTH)
    if (!clean) return

    this.socket.send(`PRIVMSG #${this.config.channelLogin} :${clean}`)
  }

  protected async beforeOpen(): Promise<void> {
    const accessToken = await this.config.oauth.getValidAccessToken()
    if (!accessToken) throw new Error('Twitch account is not connected, cannot open chat connection')
    this.accessToken = accessToken
  }

  protected onOpen(socket: WebSocket): void {
    socket.send(`PASS oauth:${this.accessToken}`)
    socket.send(`NICK ${this.config.botLogin}`)
    socket.send('CAP REQ :twitch.tv/commands twitch.tv/tags')
    socket.send(`JOIN #${this.config.channelLogin}`)
    this.accessToken = ''
  }

  protected onClosed(): void {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
  }

  // Twitch pings us already; our own ping keeps the connection alive through proxies that drop an idle socket
  private startPingLoop(): void {
    this.pingTimer ??= setInterval(() => this.socket?.send('PING :tmi.twitch.tv'), PING_INTERVAL_MS)
    this.startWatchdog(WATCHDOG_MS)
  }

  // Twitch IRC frames may contain more than one line, each separated by \r\n
  protected onMessage(raw: string): void {
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
          log.log(`Joined channel #${this.config.channelLogin}`)
          this.markReady()
          this.startPingLoop()
        }
        return
      case 'NOTICE':
        // Auth failures land here (e.g. "Login authentication failed", "Improperly formatted auth")
        if (!this.ready) this.abort(new Error(trailing || 'Twitch chat authentication failed'))
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

    log.debug(`${message.displayName}: ${message.text}`)

    void Promise.resolve(this.config.onMessage?.(message)).catch((error) => {
      log.error(`Chat message handler failed: ${error instanceof Error ? error.message : error}`)
    })
  }
}
