import { createLogger, describeError } from './logger.js'

// What changed, not how: a topic only says "read it again". The data stays behind the existing GET endpoints
export const TOPICS = ['state', 'activity', 'fallback', 'twitch', 'blocklist', 'playlists'] as const
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
export type Notice = { type: 'viewerRequest'; user: string; title: string }

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
