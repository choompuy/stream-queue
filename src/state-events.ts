import { createLogger, describeError } from './logger.js'

// What changed, not how: a topic only says "read it again". The data stays behind the existing GET endpoints
export const TOPICS = ['state', 'activity', 'fallback', 'twitch', 'blocklist', 'playlists', 'config'] as const
export type Topic = (typeof TOPICS)[number]

type Listener = () => void

const log = createLogger('EVENTS')

const listeners = Object.fromEntries(TOPICS.map((topic) => [topic, new Set<Listener>()])) as Record<Topic, Set<Listener>>

// Registers a listener (registering the same function twice is a no-op). Returns the function that unregisters it
export function on(topic: Topic, listener: Listener): () => void {
  listeners[topic].add(listener)
  return () => {
    listeners[topic].delete(listener)
  }
}

// A notice is something that happened and is worth telling to whoever watches the panel, with what it is about.
// Unlike a change it is not read again from anywhere: it exists only as long as it is being told
export const DESKTOP_NOTICE_CODES = [
  'STARTUP_FAILED',
  'NO_FREE_PORT',
  'DATA_DIR_NOT_WRITABLE',
  'PUBLIC_DIR_MISSING',
  'PORT_CHANGED',
  'SAVE_FAILED',
  'UNEXPECTED_ERROR',
  'TWITCH_CONNECTION_LOST',
  'TWITCH_REAUTH_REQUIRED',
  'YOUTUBE_QUOTA_EXHAUSTED'
] as const

export type DesktopNoticeCode = (typeof DESKTOP_NOTICE_CODES)[number]

// For the desktop user (the tray), not the panel: the panel skips a notice type it does not know, and the
// tray reads these out of the server's stdout instead. Kept here, next to the bus it travels on
export type DesktopNotice = {
  type: 'desktop'
  level: 'error' | 'warn' | 'info'
  code: DesktopNoticeCode
  params?: Record<string, string | number>
  // the fallback text for when the locale key is missing (no locales folder next to the exe)
  message?: string
  // true only for a failure the server does not survive
  fatal?: boolean
}

export type Notice =
  | { type: 'viewerRequest'; user: string; title: string }
  | { type: 'error'; level: 'error'; code: string; params?: Record<string, string | number> }
  | DesktopNotice

const noticeListeners = new Set<(notice: Notice) => void>()

export function onNotice(listener: (notice: Notice) => void): () => void {
  noticeListeners.add(listener)
  return () => {
    noticeListeners.delete(listener)
  }
}

export function notify(notice: Notice): void {
  for (const listener of [...noticeListeners]) {
    try {
      listener(notice)
    } catch (error) {
      log.error(`Listener of the notice "${notice.type}" failed: ${describeError(error)}`)
    }
  }
}

/**
 * Calls every listener of the topic. A listener that throws is logged and skipped: it must not stop the other listeners
 * or turn a change that already happened into an error for whoever caused it
 */
export function emit(topic: Topic): void {
  for (const listener of [...listeners[topic]]) {
    try {
      listener()
    } catch (error) {
      log.error(`Listener of "${topic}" failed: ${describeError(error)}`)
    }
  }
}
