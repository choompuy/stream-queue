// End-to-end smoke test of the control panel: loads the real public/index.html and public/js/control/*
// into jsdom, stubs fetch, and drives the UI. Run with `npm run test:smoke`.
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const ROOT = fileURLToPath(new URL('../public', import.meta.url))
const html = readFileSync(`${ROOT}/index.html`, 'utf8').replace(/<script[^>]*><\/script>/g, '')
const dom = new JSDOM(html, { url: 'http://localhost:4747/' })
const { window } = dom

globalThis.window = window
globalThis.document = window.document
globalThis.CSS = { escape: (s) => String(s) }
globalThis.confirm = () => true
globalThis.location = window.location
window.HTMLElement.prototype.scrollBy = () => {}
// jsdom says "prerender" until told otherwise: the panel only refreshes what a visible page shows
Object.defineProperty(window.document, 'visibilityState', { value: 'visible', configurable: true })

const calls = []
const V = (c) => c.repeat(11)
const track = (c, extra = {}) => ({
  videoId: V(c),
  title: `Track ${c}`,
  channelTitle: 'Chan',
  thumbnail: `https://i.ytimg.com/vi/${V(c)}/mqdefault.jpg`,
  duration: 100,
  views: 5,
  requestedBy: 'bob',
  isFallback: false,
  ...extra
})
let stateOverride = null
let failStateWith500 = false
let blocklist = [{ videoId: V('c'), title: 'Blocked one', blockedAt: Date.now() }]

// like the server: every track says whether it is on the list of blocked tracks
const withBlocked = (tracks) => tracks.map((item) => ({ ...item, isBlocked: blocklist.some((entry) => entry.videoId === item.videoId) }))

const routes = {
  'GET /api/locale': () => ({ locale: 'en' }),
  'GET /api/settings': () => ({ showVideo: true, position: 'bottom-right' }),
  'GET /api/config': () => ({ maxQueueSize: 20, fallbackPlaylist: { playlistId: 'PL1' } }),
  'GET /api/secrets': () => ({ hasYoutubeApiKey: true }),
  'GET /api/network-info': () => ({ ips: ['192.168.0.2'], port: 4747 }),
  'GET /api/activity': () => ({
    entries: [
      { at: Date.now(), videoId: V('a'), title: 'A $$ "quoted" & <b>', query: 'q', status: 'accepted', requestedBy: 'bob', reasonCode: null },
      {
        at: Date.now() - 1000,
        videoId: V('d'),
        title: 'Broken',
        query: 'q',
        status: 'failed',
        requestedBy: 'amy',
        reasonCode: 'PLAYBACK_EMBED_DISALLOWED'
      }
    ]
  }),
  'GET /api/blocklist': () => ({ entries: blocklist }),
  'GET /api/playlists': () => ({
    playlists: [
      { id: 'PL1', title: 'One', thumbnail: '', itemCount: 3, isActive: true },
      { id: 'PL2', title: 'Two', thumbnail: '', itemCount: 1, isActive: false }
    ]
  }),
  'GET /api/state': () => {
    if (failStateWith500) return [500, { error: 'boom', code: 'SERVER_ERROR' }]
    // the playlist is playing: like the server, the current track says so with isFallback
    const state = stateOverride ?? {
      current: track('f', { isFallback: true, requestedBy: 'Playlist' }),
      queue: [track('b'), track('c')],
      isPaused: false,
      nextTrack: null
    }
    return { ...state, queue: withBlocked(state.queue) }
  },
  'GET /api/fallback': () => ({
    upNext: withBlocked([track('e'), track('f')]),
    activeVideoId: V('f'),
    lastRefreshedAt: Date.now(),
    sourceCount: 2,
    itemCount: 5,
    shuffle: false,
    repeat: true,
    enabled: true
  }),
  [`DELETE /api/blocklist/${V('c')}`]: () => {
    blocklist = blocklist.filter((entry) => entry.videoId !== V('c'))
    return {}
  },
  'POST /api/blocklist': (body) => {
    blocklist = [{ videoId: body.videoId, title: body.title, blockedAt: Date.now() }, ...blocklist]
    return [201, { entry: blocklist[0] }]
  },
  [`POST /api/fallback/play/${V('e')}`]: () => [409, { error: 'server text', code: 'BLOCKED' }]
}

// the events of the server, driven by the test: a mutation that succeeded is announced (the real server announces the
// topics it touched; announcing them all is the same thing to the panel — a topic only says "read again")
const sources = []
const TOPICS = ['state', 'activity', 'fallback', 'blocklist', 'playlists', 'config', 'twitch']
globalThis.EventSource = class FakeEventSource {
  constructor(url) {
    this.url = url
    this.listeners = {}
    this.closed = false
    sources.push(this)
  }

  addEventListener(name, listener) {
    ;(this.listeners[name] ??= []).push(listener)
  }

  close() {
    this.closed = true
  }

  emit(name, data) {
    for (const listener of this.listeners[name] ?? []) listener({ data: data === undefined ? undefined : JSON.stringify(data) })
  }
}

const announce = () => {
  for (const topic of TOPICS) sources.at(-1)?.emit('changed', { topic })
}

globalThis.fetch = async (url, options = {}) => {
  const method = options.method ?? 'GET'
  calls.push(`${method} ${url}`)
  if (String(url).startsWith('/locales/')) return { ok: true, json: async () => JSON.parse(readFileSync(`${ROOT}${url}`, 'utf8')) }
  const handler = routes[`${method} ${url}`]
  if (!handler) return { ok: false, status: 404, json: async () => ({ error: `no route ${method} ${url}`, code: 'NOT_FOUND' }) }
  let result = handler(options.body ? JSON.parse(options.body) : undefined)
  let status = 200
  if (Array.isArray(result)) [status, result] = result
  const body = status < 400 ? { success: true, data: result } : { success: false, ...result }
  // the answer of a change that was stored is followed by its announcement, as the real server does
  if (status < 400 && method !== 'GET') queueMicrotask(announce)
  return { ok: status < 400, status, json: async () => body }
}

const errors = []
const origError = console.error
console.error = (...a) => {
  errors.push(a)
  origError(...a)
}
const logs = []
console.log = (...a) => logs.push(a.join(' '))

const { startControlPanel } = await import(pathToFileURL(`${ROOT}/js/control/index.js`).href)
await startControlPanel()
await new Promise((r) => setTimeout(r, 300))

const $ = (sel) => document.querySelector(sel)
const $$ = (sel) => [...document.querySelectorAll(sel)]
const toasts = () => $$('#toastContainer .toast-message').map((n) => n.textContent)
const tick = () => new Promise((r) => setTimeout(r, 50))
// the announcement is coalesced for 100 ms, then the reads run: wait for them
const settled = () => new Promise((r) => setTimeout(r, 250))
let passed = 0
const check = async (name, fn) => {
  await fn()
  passed++
  process.stdout.write(`  ok - ${name}\n`)
}

// --- initial render
await check('queue rows rendered with blocked pill on the blocked one', () => {
  const rows = $$('#queueListWrapper .row-item')
  assert.equal(rows.length, 2)
  assert.equal(rows[0].querySelector('.status-pill'), null)
  assert.ok(rows[1].querySelector('.status-pill'))
})
await check('queue rows: a normal row has a menu (block, remove), a blocked row a dedicated unblock button', () => {
  const rows = $$('#queueListWrapper .row-item')
  assert.deepEqual(
    [...rows[0].querySelectorAll('.row-menu-item')].map((b) => b.dataset.action),
    ['block-track', 'queue-remove']
  )
  assert.equal(rows[1].querySelector('.row-menu'), null)
  assert.equal(rows[1].querySelector('[data-action="unblock-track"]')?.dataset.videoId, V('c'))
})
await check('menu items have role=menuitem, toggles have aria-expanded=false', () => {
  assert.ok($$('.row-menu-item').every((b) => b.getAttribute('role') === 'menuitem'))
  assert.ok($$('[data-action="toggle-menu"]').every((b) => b.getAttribute('aria-expanded') === 'false'))
})
await check('fallback: rows rendered', () => {
  const rows = $$('#fallbackListWrapper .row-item')
  assert.equal(rows.length, 2)
  assert.equal(rows[1].dataset.videoId, V('f'))
})
await check('playlists: rows rendered once their page is opened (their topic is not read while the dashboard is shown)', async () => {
  $('[data-page-tab-target="playlists"]').click()
  await settled()
  const rows = $$('#playlistsListWrapper .row-item')
  assert.equal(rows.length, 2)

  $('[data-page-tab-target="dashboard"]').click()
  await settled()
})
await check('activity: escaping, thumbnail helper, translated failure reason', () => {
  const rows = $$('#activityListWrapper .row-item')
  assert.equal(rows.length, 2)
  assert.ok(rows[0].querySelector('img').src.endsWith(`/vi/${V('a')}/mqdefault.jpg`))
  assert.equal(rows[0].querySelector('.column-info .text-primary').textContent, 'A $$ "quoted" & <b>')
  assert.ok(rows[1].querySelector('.column-info .text-secondary').textContent.length > 0)
  const item = rows[0].querySelector('[data-action="block-track"]')
  assert.equal(item.dataset.title, 'A $$ "quoted" & <b>')
})
await check('blocklist rendered with thumbnail helper', () => {
  const rows = $$('#blocklistListWrapper .row-item')
  assert.equal(rows.length, 1)
  assert.ok(rows[0].querySelector('img').src.includes(`/vi/${V('c')}/`))
})

// --- menu behaviour
$('#queueListWrapper [data-action="toggle-menu"]').click()
await check('toggle-menu opens the dropdown and sets aria-expanded', () => {
  const menu = $('#queueListWrapper .row-menu')
  assert.ok(!menu.querySelector('.row-menu-dropdown').classList.contains('hidden'))
  assert.equal(menu.querySelector('[data-action="toggle-menu"]').getAttribute('aria-expanded'), 'true')
})
document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
await check('Escape closes the menu and resets aria-expanded', () => {
  const menu = $('#queueListWrapper .row-menu')
  assert.ok(menu.querySelector('.row-menu-dropdown').classList.contains('hidden'))
  assert.equal(menu.querySelector('[data-action="toggle-menu"]').getAttribute('aria-expanded'), 'false')
})
$('#queueListWrapper [data-action="toggle-menu"]').click()
document.body.click()
await check('click outside closes the menu', () => {
  assert.ok($('#queueListWrapper .row-menu-dropdown').classList.contains('hidden'))
})

// --- block flow (data attributes round-trip through the DOM)
calls.length = 0
$('#activityListWrapper [data-action="block-track"]').click()
await settled()
await check('block-track posts videoId + title exactly, and the announcement of the change reloads the blocklist and the state', () => {
  assert.ok(calls.includes('POST /api/blocklist'))
  assert.ok(calls.includes('GET /api/blocklist'))
  assert.ok(calls.includes('GET /api/state'))
  assert.ok(toasts().some((m) => m.length > 0))
  assert.equal(blocklist[0].title, 'A $$ "quoted" & <b>')
  assert.equal($$('#blocklistListWrapper .row-item').length, 2)
})

// --- unblock from the dedicated button on a blocked queue row
calls.length = 0
$('#queueListWrapper [data-action="unblock-track"]').click()
await settled()
await check('unblock-track deletes the entry, the announcement reloads the lists and the row becomes a normal one', () => {
  assert.ok(calls.includes(`DELETE /api/blocklist/${V('c')}`))
  assert.ok(calls.includes('GET /api/blocklist'))
  const rows = $$('#queueListWrapper .row-item')
  assert.equal(rows[1].querySelector('.status-pill'), null)
  assert.ok(rows[1].querySelector('.row-menu'))
  assert.equal($('#queueListWrapper [data-action="unblock-track"]'), null)
})

// --- errors: API error -> toast (translated); a read that fails -> nothing (the watcher logs it, the safety poll covers connectivity)
$(`#fallbackListWrapper [data-video-id="${V('e')}"] [data-action="fallback-play"]`).click()
await tick()
await tick()
await check('API error from an action shows a translated toast', () => {
  assert.ok(toasts().includes('This track has been blocked by the streamer'), JSON.stringify(toasts()))
})
const before = toasts().length
failStateWith500 = true
const { readState } = await import(pathToFileURL(`${ROOT}/js/control/queue.js`).href)
await assert.rejects(readState())
await check('a failed read says nothing: only actions talk to the person, reads are silent', () => assert.equal(toasts().length, before))
failStateWith500 = false

// --- server unreachable: one toast for several failing manual loads, none for the reads
const realFetch = globalThis.fetch
globalThis.fetch = async (url, options) => {
  if (String(url).startsWith('/locales/')) return realFetch(url, options)
  throw new TypeError('fetch failed')
}
const beforeNet = toasts().length
await assert.rejects(readState())
await check('a read that cannot reach the server says nothing', () => assert.equal(toasts().length, beforeNet))
const { loadSecrets, loadNetworkInfo } = await import(pathToFileURL(`${ROOT}/js/control/settings.js`).href)
const { loadTwitchConfig } = await import(pathToFileURL(`${ROOT}/js/control/twitch/index.js`).href)
await Promise.allSettled([loadSecrets(), loadNetworkInfo(), loadTwitchConfig()])
await check('several simultaneous manual loads that cannot reach the server show a single toast', () => {
  const netToasts = toasts().filter((m) => m === "Can't reach the server")
  assert.equal(netToasts.length, 1, JSON.stringify(toasts()))
})
globalThis.fetch = realFetch

// --- unknown action is logged, not thrown
const stray = document.createElement('button')
stray.dataset.action = 'does-not-exist'
document.body.append(stray)
stray.click()
await check('unknown data-action is logged instead of silently ignored', () =>
  assert.ok(logs.some((l) => l.includes('No handler registered for action "does-not-exist"')))
)

// --- programmer errors are logged but not toasted
const { run } = await import(pathToFileURL(`${ROOT}/js/control/run.js`).href)
const n = toasts().length
await run('boom', () => {
  throw new TypeError('x is undefined')
})
await check('non-API errors are logged and shown as a generic error toast', () => {
  assert.equal(toasts().length, n + 1)
  assert.ok(logs.some((l) => l.includes('Error boom:')))
})

await check('no console.error during the whole run', () => assert.deepEqual(errors, []))
console.log = () => {}
process.stdout.write(`\n${passed} checks passed\n`)
process.exit(0)
