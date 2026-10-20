import { createLogger } from './shared.js'

const log = createLogger('EVENTS')

const COALESCE_MS = 100
// the server pings every 25 s: a minute without any frame means the connection is dead (OBS and antivirus drop quiet ones without a word)
const WATCHDOG_MS = 60_000
const DOWN_AFTER_MS = 10_000
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
 * onStatus(status) 'open', or 'down' when there is no EventSource or no connection for 10 s (the page polls meanwhile)
 * onNotice(notice) something that happened and is shown as it is told (see src/state-events.ts). Told once: what is missed while the
 *                  connection is down is not told afterwards, and it is not a change to read again
 */
export function connectEvents({ topics, onChange, onStatus, onNotice, EventSourceImpl = globalThis.EventSource }) {
  if (!EventSourceImpl) {
    onStatus('down')
    return { close() {} }
  }

  const url = `/api/events?topics=${topics.join(',')}`
  const timers = createTimers()
  let source = null
  let status = null
  let closed = false

  function setStatus(next) {
    if (status === next) return

    status = next
    onStatus(next)
  }

  // a topic that is already waiting for its turn is not asked for again
  function notify(topic) {
    const name = `change:${topic}`
    if (!timers.has(name)) timers.set(name, () => onChange(topic), COALESCE_MS)
  }

  const armWatchdog = () => timers.set('watchdog', reopen, WATCHDOG_MS)

  function armDownTimer() {
    if (!timers.has('down') && status !== 'down') timers.set('down', () => setStatus('down'), DOWN_AFTER_MS)
  }

  function disposeSource() {
    timers.clear('watchdog')
    source?.close()
    source = null
  }

  function reopen() {
    disposeSource()
    open()
  }

  function open() {
    if (closed) return

    timers.clear('reopen')
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
      timers.clear('down')
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

    listen('notice', (event) => {
      armWatchdog()

      let notice
      try {
        notice = JSON.parse(event.data)
      } catch {
        return
      }

      onNotice?.(notice)
    })

    listen('ping', armWatchdog)

    listen('error', () => {
      armDownTimer()

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
