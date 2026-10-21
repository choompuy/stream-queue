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

// Set once by initializeTwitchIntegration, cleared by disconnect and stop():
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
// The lifecycle walks these for start, stop, health and reset; chat-reply also reads
// the chat one to wait for a connection before sending
export interface SocketState<T extends ReconnectingSocket> {
  instance: T | null
  starting: Promise<void> | null
}

export const eventSubConnection: SocketState<TwitchEventSub> = { instance: null, starting: null }
export const chatConnection: SocketState<TwitchChat> = { instance: null, starting: null }

// The waits and pauses of a running integration. initializeTwitchIntegration is the only writer: it takes
// them from its options (the tests pass small values there instead of sleeping through the real windows),
// and whoever has to wait or retry reads the current values.
export interface TwitchTunables {
  /** how long a chat reply waits out a start that is still running before it gives up on the message */
  chatStartWaitMs: number
  /** how long a chat reply waits out a reconnect of a once-connected chat before it gives up on the message */
  chatReconnectWaitMs: number
  /** the base delay of the Twitch retries: redemption status updates and the login's getUserInfo attempts */
  retryDelayMs: number
}

const DEFAULT_TUNABLES: TwitchTunables = {
  chatStartWaitMs: 5000,
  chatReconnectWaitMs: 60000,
  retryDelayMs: 1000
}

let tunables: TwitchTunables = { ...DEFAULT_TUNABLES }

export function getTunables(): TwitchTunables {
  return tunables
}

/** Applies the options of one initialization over a fresh copy of the defaults: the single write of them. */
export function applyTunables(options: Partial<TwitchTunables> = {}): void {
  tunables = { ...DEFAULT_TUNABLES, ...options }
}
