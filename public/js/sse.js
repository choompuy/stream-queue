const log = (...args) => console.log('[SSE]', ...args)

const DEBOUNCE_MS = 100
const WATCHDOG_MS = 60_000
const RECONNECT_DELAY_MS = 10_000

export function connectEvents({ topics, onChange, onStatus, EventSourceImpl = globalThis.EventSource }) {
  let eventSource = null
  let reconnectTimer = null
  let watchdogTimer = null
  let lastFrameTime = Date.now()
  let pendingChanges = new Set()
  let debounceTimer = null

  function handleChange(topic) {
    pendingChanges.add(topic)

    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }

    debounceTimer = setTimeout(() => {
      for (const topic of pendingChanges) {
        onChange(topic)
      }
      pendingChanges.clear()
      debounceTimer = null
    }, DEBOUNCE_MS)
  }

  function handleOpen() {
    log('Connection opened')
    onStatus('open')
    lastFrameTime = Date.now()
    startWatchdog()
  }

  function handleMessage(event) {
    lastFrameTime = Date.now()

    try {
      const data = JSON.parse(event.data)
      if (data.topic) {
        handleChange(data.topic)
      }
    } catch (error) {
      log('Failed to parse message:', error)
    }
  }

  function handleError() {
    log('Connection error')
    onStatus('down')
    stopWatchdog()
    scheduleReconnect()
  }

  function startWatchdog() {
    stopWatchdog()
    watchdogTimer = setTimeout(() => {
      const elapsed = Date.now() - lastFrameTime
      if (elapsed > WATCHDOG_MS) {
        log(`Watchdog triggered: no data for ${elapsed}ms`)
        close()
        scheduleReconnect()
      } else {
        startWatchdog()
      }
    }, WATCHDOG_MS)
  }

  function stopWatchdog() {
    if (watchdogTimer) {
      clearTimeout(watchdogTimer)
      watchdogTimer = null
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, RECONNECT_DELAY_MS)
  }

  function connect() {
    if (!EventSourceImpl) {
      log('EventSource not available')
      onStatus('down')
      return
    }

    close()

    const url = new URL('/api/events', window.location.origin)
    if (topics && topics.length > 0) {
      url.searchParams.set('topics', topics.join(','))
    }

    log(`Connecting to ${url}`)

    try {
      eventSource = new EventSourceImpl(url)

      eventSource.onopen = handleOpen
      eventSource.onmessage = handleMessage
      eventSource.onerror = handleError

      // Set a timeout for connection
      const connectTimeout = setTimeout(() => {
        if (eventSource.readyState === EventSource.CONNECTING) {
          log('Connection timeout')
          close()
          onStatus('down')
          scheduleReconnect()
        }
      }, RECONNECT_DELAY_MS)

      eventSource.addEventListener('open', () => {
        clearTimeout(connectTimeout)
      }, { once: true })
    } catch (error) {
      log('Failed to create EventSource:', error)
      onStatus('down')
      scheduleReconnect()
    }
  }

  function close() {
    stopWatchdog()
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    if (eventSource) {
      eventSource.close()
      eventSource = null
    }
  }

  // Initial connection
  connect()

  return {
    close
  }
}
