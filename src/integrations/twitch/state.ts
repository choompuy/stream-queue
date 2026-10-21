import type { TwitchOAuth } from './oauth.js'
import type { TwitchClient } from './client.js'
import type { TwitchChat } from './chat.js'
import type { TwitchEventSub } from './eventsub.js'
import type { ReconnectingSocket } from './socket.js'

// The mutable runtime of the one Twitch account this server serves. It used to be eight
// module-level `let`s scattered over index.ts: the lifecycle (index.ts) writes it when the
// integration starts and stops, the feature modules (redemptions, chat-commands,
// device-auth) read what they need, and the tests point the fields at their fakes instead
// of going through hooks.

// Set once by initializeTwitchIntegration, cleared by disconnect and the test reset:
// a null runtime means the integration is not initialized (or torn down)
export interface TwitchRuntime {
  oauth: TwitchOAuth
  client: TwitchClient
}

let runtime: TwitchRuntime | null = null

export function getRuntime(): TwitchRuntime | null {
  return runtime
}

export function setRuntime(next: TwitchRuntime | null): void {
  runtime = next
}

// One live socket entry: the instance and the start that may be running for it.
// The lifecycle walks these for start, stop, health and reset; chat-commands also reads
// the chat one to wait for a connection before replying
export interface SocketState<T extends ReconnectingSocket> {
  instance: T | null
  starting: Promise<void> | null
}

export const eventSubConnection: SocketState<TwitchEventSub> = { instance: null, starting: null }

// The chat reply waits out a start with one window and a reconnect with a longer one;
// tests shrink both windows instead of sleeping for the real 5 s / 60 s
export const CHAT_START_WAIT_MS = 5000
export const CHAT_RECONNECT_WAIT_MS = 60000

export interface ChatConnection extends SocketState<TwitchChat> {
  startWaitMs: number
  reconnectWaitMs: number
}

export const chatConnection: ChatConnection = {
  instance: null,
  starting: null,
  startWaitMs: CHAT_START_WAIT_MS,
  reconnectWaitMs: CHAT_RECONNECT_WAIT_MS
}

// One backoff knob for the Twitch retries that have to live through tests: the redemption
// status updates and the login's getUserInfo attempts. Tests shrink it to keep the suites
// fast; the reset below restores the real pace
export const REDEMPTION_RETRY_DELAY_MS = 1000

export const twitchBackoff = { delayMs: REDEMPTION_RETRY_DELAY_MS }

// Restores every tunable the tests may have shrunk (used by _resetIntegration)
export function resetTunables(): void {
  chatConnection.startWaitMs = CHAT_START_WAIT_MS
  chatConnection.reconnectWaitMs = CHAT_RECONNECT_WAIT_MS
  twitchBackoff.delayMs = REDEMPTION_RETRY_DELAY_MS
}
