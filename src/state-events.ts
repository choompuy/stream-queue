import { createLogger, describeError } from './logger.js'

// What changed, not how: a topic only says "read it again". The data stays behind the existing GET endpoints
export const TOPICS = ['state', 'activity', 'fallback', 'twitch'] as const
export type Topic = (typeof TOPICS)[number]

type Listener = () => void

const log = createLogger('EVENTS')

const listeners: Record<Topic, Set<Listener>> = {
  state: new Set(),
  activity: new Set(),
  fallback: new Set(),
  twitch: new Set()
}

// Registers a listener (registering the same function twice is a no-op). Returns the function that unregisters it
export function on(topic: Topic, listener: Listener): () => void {
  listeners[topic].add(listener)
  return () => {
    listeners[topic].delete(listener)
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
