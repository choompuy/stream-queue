import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { setupPanel, installYouTube, flush, makeTrack as track } from './control/panel-env.js'

mock.method(console, 'log', () => {})
mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })

// OBS is on this computer, the overlay is opened by the LAN address (a phone, another PC)
const env = setupPanel({ page: 'overlay.html', url: 'http://192.168.0.2:4747/overlay' })
const { players } = installYouTube()
globalThis.EventSource = undefined

const lockRequests = []
env.route('GET /api/overlay-state', {
  settings: { locale: 'en', showVideo: true, hideOverlayInfo: false, opacity: 100, position: 'bottom-right' },
  state: { current: track('a'), isPaused: false, nextTrack: null }
})

const { startOverlay } = await import('../../public/js/overlay.js')
const overlay = startOverlay({ locks: { request: (name) => lockRequests.push(name) } })
for (let i = 0; i < 6; i++) await flush()

test('an overlay opened by another address than localhost', async (t) => {
  await t.test('shows the badge, and neither plays the music nor competes for the right to', () => {
    assert.equal(env.$('#badge').classList.contains('visible'), true)
    assert.equal(env.$('#currentTitle').textContent, 'Track a')
    assert.equal(players.length, 0)
    assert.deepEqual(lockRequests, [])
  })

  overlay.stop()
  mock.timers.reset()
})
