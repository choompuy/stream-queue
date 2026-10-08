import WebSocket from 'ws'
import { describeError, type createLogger } from '../../logger.js'

/**
 * Closes a socket that may still be connecting. ws emits 'error' when a CONNECTING socket is closed; with the listeners
 * removed that error would be unhandled and take the whole process down, so an empty listener stays behind.
 */
export function closeQuietly(socket: WebSocket | null | undefined): void {
  if (!socket) return

  socket.removeAllListeners()
  socket.on('error', () => {})

  try {
    socket.close()
  } catch {
    // already closed
  }
}

export abstract class ReconnectingSocket {
  protected socket: WebSocket | null = null
  protected ready = false
  protected stopped = false
  // maxAttempts is unlimited on purpose: after a sleep or a network outage the connection must come back by itself, however long it took
  protected timing = { initialDelayMs: 5_000, maxDelayMs: 60_000, maxAttempts: Infinity, readyTimeoutMs: 10_000, stableAfterMs: 30_000 }

  protected abstract readonly log: ReturnType<typeof createLogger>
  protected abstract readonly url: string
  protected abstract readonly readyName: string
  protected abstract onMessage(data: string): void | Promise<void>
  protected beforeOpen(): void | Promise<void> {}
  protected onOpen(_socket: WebSocket): void {}
  protected onClosed(): void {}

  private starting: Promise<void> | null = null
  private attempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null
  private stableTimer: ReturnType<typeof setTimeout> | null = null
  private watchdogMs = 0
  private pending: { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } | null = null

  connect(): Promise<void> {
    if (this.stopped) this.attempts = 0
    this.stopped = false
    if (this.isConnected()) return Promise.resolve()

    // a second caller joins the attempt in progress instead of starting another one (or being told "connected" too early)
    if (!this.starting) {
      const attempt: Promise<void> = this.start().finally(() => {
        if (this.starting === attempt) this.starting = null
      })
      this.starting = attempt
    }

    return this.starting
  }

  private async start(): Promise<void> {
    this.clearReconnectTimer()
    await this.beforeOpen()
    // disconnect() may have been called while the token was being fetched: no socket must be opened after it
    if (this.stopped) throw new Error('Disconnected')
    await this.open(this.url)
    await this.waitReady()
    this.markStable()
  }

  async disconnect(): Promise<void> {
    this.stopped = true
    this.clearReconnectTimer()
    this.failPending(new Error('Disconnected'))

    const socket = this.socket
    this.socket = null
    this.teardown()

    if (!socket) return

    closeQuietly(socket)
    this.log.log('Disconnected')
  }

  // does not undo a disconnect(): the caller of a failed first connect() must not bring back a socket that was closed on purpose
  retryInBackground(): void {
    this.scheduleReconnect()
  }

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN && this.ready
  }

  protected markReady(): void {
    this.ready = true
    this.pending?.resolve()
    this.pending = null
  }

  protected abort(error: Error): void {
    this.failPending(error)
    this.dropSocket()
  }

  // Whoever waits for the socket to become ready must always be answered: a connect() left waiting would never end,
  // and with it no reconnect would ever start. The rejected wait stays in place, so a waitReady() that starts only
  // afterwards still ends with the real reason (the next open() replaces it)
  private failPending(error: Error): void {
    this.pending?.reject(error)
  }

  protected dropSocket(): void {
    const socket = this.socket
    this.socket = null
    this.teardown()
    closeQuietly(socket)
  }

  private markStable(): void {
    if (this.stableTimer) clearTimeout(this.stableTimer)

    this.stableTimer = setTimeout(() => {
      this.stableTimer = null
      this.attempts = 0
    }, this.timing.stableAfterMs)
  }

  private teardown(): void {
    this.ready = false
    if (this.stableTimer) clearTimeout(this.stableTimer)
    this.stableTimer = null
    this.stopWatchdog()
    this.onClosed()
  }

  /**
   * Silence for longer than `ms` means the connection is dead even though the socket still looks open
   * (sleep, a changed network): it is dropped and reconnected. Any incoming message counts as a sign of life.
   */
  protected startWatchdog(ms: number): void {
    this.watchdogMs = ms
    this.armWatchdog()
  }

  protected stopWatchdog(): void {
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer)
    this.watchdogTimer = null
    this.watchdogMs = 0
  }

  private armWatchdog(): void {
    if (!this.watchdogMs) return
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer)

    this.watchdogTimer = setTimeout(() => {
      this.watchdogTimer = null
      this.log.warn(`No data for ${Math.round(this.watchdogMs / 1000)}s, the connection is considered dead, reconnecting`)
      this.restart()
    }, this.watchdogMs)
  }

  protected restart(): void {
    this.clearReconnectTimer()
    this.failPending(new Error('Restarted'))
    this.dropSocket()
    this.scheduleReconnect()
  }

  protected open(url: string): Promise<void> {
    let resolve!: () => void
    let reject!: (error: Error) => void
    const promise = new Promise<void>((res, rej) => {
      resolve = res
      reject = rej
    })
    promise.catch(() => {})
    this.pending = { promise, resolve, reject }

    const socket = new WebSocket(url)
    this.socket = socket

    const opened = new Promise<void>((resolveOpen, rejectOpen) => {
      let isOpen = false

      socket.once('open', () => {
        isOpen = true
        this.onOpen(socket)
        resolveOpen()
      })

      socket.on('message', (data) => {
        if (this.socket === socket) this.armWatchdog()

        Promise.resolve()
          .then(() => this.onMessage(data.toString()))
          .catch((error) => this.log.error(`Failed to handle message: ${describeError(error)}`))
      })

      socket.on('close', () => this.handleClose(socket))

      socket.on('error', (error) => {
        if (isOpen) {
          this.log.error(`WebSocket error: ${error.message}`)
          return
        }
        if (this.socket === socket) this.socket = null
        this.failPending(error)
        rejectOpen(error)
      })
    })

    // a close or a restart while the socket is still connecting settles the pending wait too, so this cannot hang
    return Promise.race([opened, promise])
  }

  protected async waitReady(): Promise<void> {
    if (this.ready) return
    if (!this.pending) throw new Error(`Not waiting for ${this.readyName}`)

    const timer = setTimeout(() => this.abort(new Error(`Timed out waiting for ${this.readyName}`)), this.timing.readyTimeoutMs)

    try {
      await this.pending.promise
    } finally {
      clearTimeout(timer)
    }
  }

  protected canReconnect(): boolean {
    return true
  }

  protected scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer || this.starting) return

    if (!this.canReconnect()) {
      this.log.warn('Not reconnecting: connect the account again, then the connection is restored')
      return
    }

    const delay = Math.min(this.timing.initialDelayMs * 2 ** this.attempts, this.timing.maxDelayMs)
    this.attempts++

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null

      this.connect().catch((error) => {
        this.log.error(`Reconnect failed (attempt ${this.attempts}): ${describeError(error)}`)
        this.scheduleReconnect()
      })
    }, delay)
  }

  private handleClose(socket: WebSocket): void {
    if (this.socket !== socket) return

    this.socket = null
    this.failPending(new Error('Connection closed before it was ready'))
    this.teardown()

    if (this.stopped) return

    this.log.warn('Connection closed')
    this.scheduleReconnect()
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }
}
