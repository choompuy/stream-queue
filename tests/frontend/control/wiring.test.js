import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { setupPanel, installEventSource, flush, deferred, makeTrack as track } from './panel-env.js'

const panel = setupPanel()
const sources = installEventSource()
mock.method(console, 'log', () => {})
mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })

const twitchStatus = { connected: true, user: { displayName: 'Streamer', login: 'streamer', profileImageUrl: '' }, health: { auth: 'ok', eventSub: true, chat: true } }

panel.route('GET /api/settings', { locale: 'en', showVideo: true, position: 'bottom-right' })
panel.route('GET /api/config', { maxQueueSize: 20 })
panel.route('GET /api/secrets', { hasYoutubeApiKey: true, twitch: { configured: true } })
panel.route('GET /api/network-info', { ips: ['192.168.0.2'], port: 4747 })
panel.route('GET /api/activity', { entries: [] })
panel.route('GET /api/blocklist', { entries: [] })
panel.route('GET /api/playlists', { playlists: [] })
panel.route('GET /api/state', { current: track('a'), queue: [], isPaused: false })
panel.route('GET /api/fallback', { upNext: [], activeVideoId: null, lastRefreshedAt: 1, sourceCount: 0, shuffle: false, repeat: false, enabled: false })
panel.route('GET /api/integrations/twitch', twitchStatus)
panel.route('GET /api/integrations/twitch/config', {})
panel.route('GET /api/integrations/twitch/rewards', { rewards: [] })

const { startControlPanel } = await import('../../../public/js/control/index.js')
const { switchPageTab } = await import('../../../public/js/control/tabs.js')

const READ = { state: 'GET /api/state', activity: 'GET /api/activity', fallback: 'GET /api/fallback', twitch: 'GET /api/integrations/twitch' }
const source = () => sources.at(-1)

// the events are coalesced for 100 ms, then the reads run
async function elapse(ms) {
  mock.timers.tick(ms)
  await flush()
}

const panelHandle = await startControlPanel()

test('the control panel and its events', async (t) => {
  await t.test('opens one connection for the four topics', () => {
    assert.equal(sources.length, 1)
    assert.equal(source().url, '/api/events?topics=state,activity,fallback,twitch')
  })

  await t.test('everything is read again each time the connection comes up: what changed while it was down was never announced', async () => {
    panel.calls.length = 0

    source().emit('open')
    await elapse(100)

    for (const call of Object.values(READ)) assert.equal(panel.count(call) >= 1, true, call)
  })

  await t.test('a change of one topic reads only that topic', async () => {
    panel.calls.length = 0

    source().emit('changed', { topic: 'activity' })
    await elapse(100)

    assert.deepEqual(panel.calls, [READ.activity])
  })

  await t.test('changes that come while the dashboard is hidden are not read, except the Twitch status, which is shown on every tab', async () => {
    switchPageTab('settings')
    panel.calls.length = 0

    for (const topic of Object.keys(READ)) source().emit('changed', { topic })
    await elapse(100)

    assert.deepEqual(panel.calls, [READ.twitch])
    switchPageTab('dashboard')
    await flush()
  })

  await t.test('reads of one topic never overlap, and a change that comes during a read gets one more read after it', async () => {
    const first = deferred()
    let running = 0
    let peak = 0
    let started = 0
    panel.route(READ.state, async () => {
      started++
      running++
      peak = Math.max(peak, running)
      if (started === 1) await first.promise
      running--
      return { current: track('a'), queue: [], isPaused: false }
    })
    panel.calls.length = 0

    for (let i = 0; i < 3; i++) {
      source().emit('changed', { topic: 'state' })
      await elapse(100)
    }
    first.resolve()
    await flush()
    await flush()

    assert.equal(started, 2)
    assert.equal(peak, 1)
  })

  await t.test('while the events are down the panel polls every 10 s, and stops when they are back', async () => {
    panel.calls.length = 0

    source().emit('error')
    await elapse(10_000)
    panel.calls.length = 0

    await elapse(10_000)
    assert.equal(panel.count(READ.state), 1)
    assert.equal(panel.count(READ.activity), 1)

    source().emit('open')
    await elapse(100)
    panel.calls.length = 0

    await elapse(30_000)
    assert.deepEqual(panel.calls, [])
  })

  await t.test('stop() closes the connection and nothing is read afterwards', async () => {
    panelHandle.stop()
    panel.calls.length = 0

    assert.equal(source().closed, true)
    await elapse(60_000)
    assert.deepEqual(panel.calls, [])
  })
})
