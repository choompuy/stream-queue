type Listener = () => void

const listeners = new Set<Listener>()

// Registers a listener (registering the same function twice is a no-op). Returns the function that unregisters it
export function onStateChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Calls every listener. A listener that throws is logged and skipped: it must not stop the other listeners
 * or turn a state change that already happened into an error for whoever caused it
 */
export function notifyStateChange(): void {
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch (error) {
      console.error('[STATE] Listener failed:', error instanceof Error ? error.message : error)
    }
  }
}
