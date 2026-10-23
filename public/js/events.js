const COALESCE_MS = 100
const REOPEN_AFTER_MS = 3_000
const CLOSED = 2

// named timers: setting one replaces the one that was set under the same name
function createTimers() {
  const timers = new Map()

  return {
    has: (name) => timers.has(name),
    set(name, callback, ms) {
      clearTimeout(timers.get(name))
      timers.set(
        name,
        setTimeout(() => {
          timers.delete(name)
          callback()
        }, ms)
      )
    },
    clear(name) {
      clearTimeout(timers.get(name))
      timers.delete(name)
    },
    clearAll() {
      timers.forEach(clearTimeout)
      timers.clear()
    }
  }
}

/**
 * Listens to /api/events: a frame only says "this topic changed, read it again", the data comes from the usual GET.
 *
 * onChange(topic)  at most once per 100 ms per topic. Called for every topic on each (re)connect too: what changed while
 *                  the connection was down was never announced, so the page has to compare
 * onNotice(notice) something that happened and is shown as it is told (see src/state-events.ts). Told once: what is missed while the
 *                  connection is down is not told afterwards, and it is not a change to read again
 * announceFirstOpen  whether the connection's first open announces every topic. A page that read everything itself
 *                    right before (watch's `readNow`) passes false: its first open would only repeat that read
 */
export function connectEvents({ topics, onChange, onNotice, EventSourceImpl = globalThis.EventSource, announceFirstOpen = true }) {
  if (!EventSourceImpl) {
    return { close() {} }
  }

  const url = `/api/events?topics=${topics.join(',')}`
  const timers = createTimers()
  let source = null
  let closed = false
  let openedBefore = false

  // a topic that is already waiting for its turn is not asked for again
  function notify(topic) {
    const name = `change:${topic}`
    if (!timers.has(name)) timers.set(name, () => onChange(topic), COALESCE_MS)
  }

  function disposeSource() {
    source?.close()
    source = null
  }

  function open() {
    if (closed) return

    timers.clear('reopen')

    const current = new EventSourceImpl(url)
    source = current

    // what a closed or replaced connection still says (a frame already on its way) is not heard
    const listen = (name, handler) => {
      current.addEventListener(name, (event) => {
        if (!closed && source === current) handler(event)
      })
    }

    listen('open', () => {
      // the page that read everything itself right before (watch's first read) skips the announcement of this first
      // open; every later one announces everything, because what changed while the connection was down was never announced
      if (announceFirstOpen || openedBefore) topics.forEach(notify)
      openedBefore = true
    })

    listen('changed', (event) => {
      try {
        const { topic } = JSON.parse(event.data)
        if (topics.includes(topic)) notify(topic)
      } catch {
        // a frame that is not ours says nothing
      }
    })

    listen('notice', (event) => {
      let notice
      try {
        notice = JSON.parse(event.data)
      } catch {
        return
      }

      onNotice?.(notice)
    })

    listen('error', () => {
      // the browser reconnects by itself, unless it gave up (an error answer such as 503): then it is done here
      if (current.readyState === CLOSED) {
        disposeSource()
        if (!timers.has('reopen')) timers.set('reopen', open, REOPEN_AFTER_MS)
      }
    })
  }

  open()

  return {
    close() {
      closed = true
      disposeSource()
      timers.clearAll()
    }
  }
}
