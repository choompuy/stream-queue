const COALESCE_MS = 100
// the server pings every 25 s: a minute without any frame means the connection is dead (OBS and antivirus drop quiet ones without a word)
const WATCHDOG_MS = 60_000
const DOWN_AFTER_MS = 10_000
const REOPEN_AFTER_MS = 3_000
const CLOSED = 2

/**
 * Listens to /api/events: a frame only says "this topic changed, read it again", the data comes from the usual GET.
 *
 * onChange(topic)  at most once per 100 ms per topic. Called for every topic on each (re)connect too: what changed while
 *                  the connection was down was never announced, so the page has to compare
 * onStatus(status) 'open', or 'down' when there is no EventSource or no connection for 10 s (the page polls meanwhile)
 */
export function connectEvents({ topics, onChange, onStatus, EventSourceImpl = globalThis.EventSource }) {
  if (!EventSourceImpl) {
    onStatus('down')
    return { close() {} }
  }

  const url = `/api/events?topics=${topics.join(',')}`
  const coalescing = new Map()
  let source = null
  let status = null
  let closed = false
  let watchdogTimer = null
  let downTimer = null
  let reopenTimer = null

  function setStatus(next) {
    if (status === next) return

    status = next
    onStatus(next)
  }

  function notify(topic) {
    if (coalescing.has(topic)) return

    coalescing.set(
      topic,
      setTimeout(() => {
        coalescing.delete(topic)
        onChange(topic)
      }, COALESCE_MS)
    )
  }

  function armWatchdog() {
    clearTimeout(watchdogTimer)
    watchdogTimer = setTimeout(reopen, WATCHDOG_MS)
  }

  function armDownTimer() {
    if (downTimer || status === 'down') return

    downTimer = setTimeout(() => {
      downTimer = null
      setStatus('down')
    }, DOWN_AFTER_MS)
  }

  function disposeSource() {
    clearTimeout(watchdogTimer)
    source?.close()
    source = null
  }

  function reopen() {
    disposeSource()
    open()
  }

  function open() {
    if (closed) return

    clearTimeout(reopenTimer)
    reopenTimer = null
    armDownTimer()

    const current = new EventSourceImpl(url)
    source = current

    // what a closed or replaced connection still says (a frame already on its way) is not heard
    const listen = (name, handler) => {
      current.addEventListener(name, (event) => {
        if (!closed && source === current) handler(event)
      })
    }

    listen('open', () => {
      clearTimeout(downTimer)
      downTimer = null
      setStatus('open')
      armWatchdog()
      topics.forEach(notify)
    })

    listen('changed', (event) => {
      armWatchdog()

      try {
        const { topic } = JSON.parse(event.data)
        if (topics.includes(topic)) notify(topic)
      } catch {
        // a frame that is not ours says nothing
      }
    })

    listen('ping', armWatchdog)

    listen('error', () => {
      armDownTimer()

      // the browser reconnects by itself, unless it gave up (an error answer such as 503): then it is done here
      if (current.readyState === CLOSED) {
        disposeSource()
        reopenTimer ??= setTimeout(open, REOPEN_AFTER_MS)
      }
    })
  }

  open()

  return {
    close() {
      closed = true
      disposeSource()
      clearTimeout(downTimer)
      clearTimeout(reopenTimer)
      coalescing.forEach(clearTimeout)
      coalescing.clear()
    }
  }
}

// Runs the task one at a time. A request that comes while it is running makes it run once more afterwards,
// so the last thing shown is always the answer to the last request, never an older one that arrived late
export function serialized(task) {
  let running = false
  let again = false

  return async () => {
    if (running) {
      again = true
      return
    }

    running = true
    try {
      do {
        again = false
        await task()
      } while (again)
    } finally {
      running = false
    }
  }
}
