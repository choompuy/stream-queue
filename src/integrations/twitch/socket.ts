import WebSocket from 'ws'
import type { createLogger } from '../../logger.js'

export abstract class ReconnectingSocket {
  protected socket: WebSocket | null = null
  protected ready = false
  protected stopped = false
  protected timing = { initialDelayMs: 5_000, maxDelayMs: 60_000, maxAttempts: 10, readyTimeoutMs: 10_000 }

  protected abstract readonly log: ReturnType<typeof createLogger>
  protected abstract readonly url: string
  protected abstract readonly readyName: string
  protected abstract onMessage(data: string): void | Promise<void>
  protected beforeOpen(): void | Promise<void> {}
  protected onOpen(_socket: WebSocket): void {}
  protected onClosed(): void {}

  private connecting = false
  private attempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pending: { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } | null = null

  async connect(): Promise<void> {
    if (this.stopped) this.attempts = 0
    this.stopped = false
    if (this.isConnected() || this.connecting) return

    this.clearReconnectTimer()
    this.connecting = true

    try {
      await this.beforeOpen()
      await this.open(this.url)
      await this.waitReady()
      this.attempts = 0
    } finally {
      this.connecting = false
    }
  }

  async disconnect(): Promise<void> {
    this.stopped = true
    this.connecting = false
    this.clearReconnectTimer()
    this.pending = null

    const socket = this.socket
    this.socket = null
    this.ready = false
    this.onClosed()

    if (!socket) return

    socket.removeAllListeners()
    socket.close()
    this.log.log('Disconnected')
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
    this.pending?.reject(error)
    this.dropSocket()
  }

  protected dropSocket(): void {
    const socket = this.socket
    this.socket = null
    this.ready = false
    this.onClosed()
    socket?.close()
  }

  protected restart(): void {
    this.clearReconnectTimer()
    this.pending = null
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

    return new Promise((resolveOpen, rejectOpen) => {
      let opened = false

      socket.once('open', () => {
        opened = true
        this.onOpen(socket)
        resolveOpen()
      })

      socket.on('message', (data) => {
        Promise.resolve()
          .then(() => this.onMessage(data.toString()))
          .catch((error) => this.log.error(`Failed to handle message: ${error instanceof Error ? error.message : error}`))
      })

      socket.on('close', () => this.handleClose(socket))

      socket.on('error', (error) => {
        if (opened) {
          this.log.error(`WebSocket error: ${error.message}`)
          return
        }
        if (this.socket === socket) this.socket = null
        this.pending?.reject(error)
        rejectOpen(error)
      })
    })
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

  protected scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer || this.connecting) return

    if (this.attempts >= this.timing.maxAttempts) {
      this.log.error(`Max reconnect attempts (${this.timing.maxAttempts}) reached, giving up`)
      return
    }

    const delay = Math.min(this.timing.initialDelayMs * 2 ** this.attempts, this.timing.maxDelayMs)
    this.attempts++

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null

      this.connect().catch((error) => {
        this.log.error(`Reconnect failed (attempt ${this.attempts}/${this.timing.maxAttempts}): ${error instanceof Error ? error.message : error}`)
        this.scheduleReconnect()
      })
    }, delay)
  }

  private handleClose(socket: WebSocket): void {
    if (this.socket !== socket) return

    this.socket = null
    this.ready = false
    this.pending = null
    this.onClosed()

    if (this.stopped) return

    this.log.warn('Connection closed')
    this.scheduleReconnect()
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }
}
