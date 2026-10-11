// A page to run the real modules against: the real public/index.html (or another page of public/) in jsdom, and a fetch that answers from a table of routes
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PUBLIC_DIR = fileURLToPath(new URL('../../../public', import.meta.url))

export const V = (char) => char.repeat(11)

export const makeTrack = (char, extra = {}) => ({
  videoId: V(char),
  title: `Track ${char}`,
  channelTitle: 'Chan',
  thumbnail: `https://i.ytimg.com/vi/${V(char)}/mqdefault.jpg`,
  duration: 100,
  views: 5,
  requestedBy: 'bob',
  ...extra
})

export function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

// Routes are 'METHOD /url'. A handler gets the parsed request body and returns the data of a successful answer,
// or [status, body] for a refusal; it may return a promise to decide when the answer arrives.
export function setupPanel({ url = 'http://localhost:4747/', page = 'index.html' } = {}) {
  const html = readFileSync(`${PUBLIC_DIR}/${page}`, 'utf8').replace(/<script[^>]*><\/script>/g, '')
  const { window } = new JSDOM(html, { url })

  Object.assign(globalThis, {
    window,
    document: window.document,
    location: window.location,
    CSS: { escape: String },
    confirm: () => true
  })
  window.HTMLElement.prototype.scrollBy = () => {}

  const calls = []
  const routes = new Map()

  globalThis.fetch = async (path, options = {}) => {
    if (String(path).startsWith('/locales/')) return { ok: true, json: async () => JSON.parse(readFileSync(`${PUBLIC_DIR}${path}`, 'utf8')) }

    const method = options.method ?? 'GET'
    calls.push(`${method} ${path}`)

    const handler = routes.get(`${method} ${path}`)
    let status = 200
    let body = { success: false, error: `no route ${method} ${path}`, code: 'NOT_FOUND' }

    if (handler) {
      const result = await handler(options.body ? JSON.parse(options.body) : undefined)
      if (Array.isArray(result)) {
        status = result[0]
        body = { success: false, ...result[1] }
      } else {
        body = { success: true, data: result }
      }
    } else {
      status = 404
    }

    return { ok: status < 400, status, json: async () => body }
  }

  return {
    calls,
    route: (key, handler) => routes.set(key, typeof handler === 'function' ? handler : () => handler),
    count: (call) => calls.filter((entry) => entry === call).length,
    $: (selector) => document.querySelector(selector),
    $$: (selector) => [...document.querySelectorAll(selector)],
    toasts: () => [...document.querySelectorAll('.toast-wrapper:not(.toast-leaving) .toast-message')].map((node) => node.textContent)
  }
}

// lets the promises that are waiting for a fetch answer or a microtask run (timers are not touched, so it works with mocked ones)
export const flush = () => new Promise((resolve) => setImmediate(resolve))

// An EventSource that the test drives: instances.at(-1).emit('changed', { topic: 'state' })
export function installEventSource() {
  const instances = []

  globalThis.EventSource = class FakeEventSource {
    constructor(url) {
      this.url = url
      this.readyState = 0
      this.listeners = {}
      this.closed = false
      instances.push(this)
    }

    addEventListener(name, listener) {
      ;(this.listeners[name] ??= []).push(listener)
    }

    close() {
      this.closed = true
      this.readyState = 2
    }

    emit(name, data) {
      if (name === 'open') this.readyState = 1
      for (const listener of this.listeners[name] ?? []) listener({ data: data === undefined ? undefined : JSON.stringify(data) })
    }
  }

  return instances
}

// A YouTube player that the test drives: players[0].emit('onError', 100). It keeps the calls it received in `calls`.
export function installYouTube() {
  const players = []
  const PlayerState = { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 }

  class FakePlayer {
    constructor(elementId, options) {
      this.options = options
      this.videoId = null
      this.state = -1
      this.time = 0
      this.calls = []
      this.destroyed = false
      players.push(this)
      queueMicrotask(() => options.events.onReady({ target: this }))
    }

    setVolume() {}
    setOption() {}
    unloadModule() {}
    getVideoData() {
      return { video_id: this.videoId }
    }
    getPlayerState() {
      return this.state
    }
    getCurrentTime() {
      return this.time
    }
    loadVideoById(arg) {
      this.videoId = typeof arg === 'string' ? arg : arg.videoId
      this.state = PlayerState.PLAYING
      this.calls.push(['load', arg])
    }
    cueVideoById(arg) {
      this.videoId = typeof arg === 'string' ? arg : arg.videoId
      this.state = PlayerState.CUED
      this.calls.push(['cue', arg])
    }
    playVideo() {
      this.state = PlayerState.PLAYING
      this.calls.push(['play'])
    }
    pauseVideo() {
      this.state = PlayerState.PAUSED
      this.calls.push(['pause'])
    }
    stopVideo() {
      this.state = -1
      this.calls.push(['stop'])
    }
    destroy() {
      this.destroyed = true
    }

    emit(handler, data) {
      this.options.events[handler]({ data, target: this })
    }
  }

  globalThis.window.YT = globalThis.YT = { Player: FakePlayer, PlayerState }
  globalThis.requestAnimationFrame = (callback) => setImmediate(() => callback(0))

  return { players, PlayerState }
}
