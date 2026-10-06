import { createLogger, describeError } from './logger.js'

export type Topic = 'state' | 'activity' | 'fallback' | 'twitch'

type Listener = () => void

const log = createLogger('STATE')

const listeners = new Map<Topic, Set<Listener>>()

for (const topic of ['state', 'activity', 'fallback', 'twitch'] as Topic[]) {
  listeners.set(topic, new Set())
}

// Registers a listener for a specific topic. Returns the function that unregisters it
export function on(topic: Topic, listener: Listener): () => void {
  const topicListeners = listeners.get(topic)
  if (!topicListeners) {
    throw new Error(`Unknown topic: ${topic}`)
  }
  topicListeners.add(listener)
  return () => {
    topicListeners.delete(listener)
  }
}

/**
 * Calls every listener for a topic. A listener that throws is logged and skipped: it must not stop the other listeners
 * or turn a state change that already happened into an error for whoever caused it
 */
export function emit(topic: Topic): void {
  const topicListeners = listeners.get(topic)
  if (!topicListeners) return

  for (const listener of [...topicListeners]) {
    try {
      listener()
    } catch (error) {
      log.error(`Listener failed for topic ${topic}: ${describeError(error)}`)
    }
  }
}

// Legacy compatibility - deprecated
export function onStateChange(listener: Listener): () => void {
  return on('state', listener)
}

export function notifyStateChange(): void {
  emit('state')
}
