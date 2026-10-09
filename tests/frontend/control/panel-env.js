// A control panel to run the real modules against: the real public/index.html in jsdom, and a fetch that answers from a table of routes
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
export function setupPanel({ url = 'http://localhost:4747/' } = {}) {
  const html = readFileSync(`${PUBLIC_DIR}/index.html`, 'utf8').replace(/<script[^>]*><\/script>/g, '')
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
