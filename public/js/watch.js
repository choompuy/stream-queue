import { connectEvents } from './events.js'
import { createLogger } from './shared.js'
import { serialized } from './serialized.js'

const log = createLogger('WATCH')

/**
 * Keeps a page up to date with the server. `topics` is { name: { read, isShown } }: what each topic reads again and, optionally,
 * whether anyone looks at it now (a topic that is not shown is not read; whoever shows it again reads it).
 *
 *  - a topic is read one at a time, and a change that is announced while it is read makes it read once more (see serialized)
 *  - everything is read when the connection comes up: what changed while it was down was never announced
 *  - while the connection is down the page reads everything every `safetyMs`, as it did before there were events
 *
 * Returns refresh(name), refreshAll(), isOpen() and close().
 */
export function watch(topics, { onNotice, safetyMs = 10_000, EventSourceImpl } = {}) {
  const names = Object.keys(topics)
  // a read that fails is logged here: nobody awaits what an event or a timer starts, and a rejection would go unhandled
  const guarded = (name) => async () => {
    try {
      await topics[name].read()
    } catch (error) {
      log(`Reading "${name}" failed:`, error)
    }
  }

  const reads = Object.fromEntries(names.map((name) => [name, serialized(guarded(name))]))
  let open = false
  let safetyNet = null

  const isShown = (name) => topics[name].isShown?.() ?? true
  const refresh = (name) => (isShown(name) ? reads[name]() : undefined)
  const refreshAll = () => Promise.all(names.map((name) => refresh(name)))

  const events = connectEvents({
    topics: names,
    onChange: refresh,
    onNotice,
    onStatus: (status) => {
      open = status === 'open'

      if (open) {
        clearInterval(safetyNet)
        safetyNet = null
      } else {
        safetyNet ??= setInterval(refreshAll, safetyMs)
      }
    },
    EventSourceImpl
  })

  return {
    refresh,
    refreshAll,
    isOpen: () => open,
    close() {
      events.close()
      clearInterval(safetyNet)
    }
  }
}
