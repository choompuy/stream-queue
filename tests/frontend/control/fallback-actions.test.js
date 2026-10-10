import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setupPanel, makeTrack as track, V } from './panel-env.js'

const panel = setupPanel()

const { initI18n } = await import('../../../public/js/i18n.js')
await initI18n('en')
const { state } = await import('../../../public/js/control/state.js')
const actions = await import('../../../public/js/control/fallback-actions.js')

const fallback = (extra = {}) => ({ upNext: [track('f'), track('g')], activeVideoId: null, lastRefreshedAt: 1, sourceCount: 2, shuffle: false, repeat: false, enabled: false, ...extra })

state.fallback = fallback()
state.current = track('a')
panel.route('GET /api/state', () => ({ current: track('a'), queue: [track('b'), track('c')], isPaused: false }))
panel.route('GET /api/fallback', () => fallback())

test('the switches of the playlist', async (t) => {
  await t.test('shuffle, repeat and enabled show the state the server answers, not the one the panel guessed', async () => {
    panel.route('POST /api/fallback/shuffle', fallback({ shuffle: true }))
    panel.route('POST /api/fallback/repeat', fallback({ repeat: true }))
    panel.route('POST /api/fallback/enabled', fallback({ enabled: true }))

    await actions.toggleFallbackShuffle()
    assert.equal(state.fallback.shuffle, true)

    await actions.toggleFallbackRepeat()
    assert.equal(state.fallback.repeat, true)

    await actions.toggleFallbackEnabled()
    assert.equal(state.fallback.enabled, true)
    assert.equal(panel.$('#fallbackEnabledText').textContent, 'On')
  })

  await t.test('a refused switch leaves the playlist as it was and reports the error', async () => {
    state.fallback = fallback()
    panel.route('POST /api/fallback/shuffle', [500, { error: 'raw', code: 'SERVER_ERROR' }])

    await actions.toggleFallbackShuffle()

    assert.equal(state.fallback.shuffle, false)
    assert.ok(panel.toasts().includes('Internal server error'))
  })
})

test('refreshing the playlist', async (t) => {
  await t.test('asks the server to reload it, reads it, and says so', async () => {
    panel.route('POST /api/fallback/refresh', {})
    panel.calls.length = 0

    await actions.refreshFallback()

    assert.deepEqual(panel.calls, ['POST /api/fallback/refresh', 'GET /api/fallback'])
    assert.ok(panel.toasts().includes('Playlist refreshed'))
  })
})

test('a track of the playlist', async (t) => {
  await t.test('"play now" starts it, reads the state, and names the track', async () => {
    state.fallback = fallback()
    panel.route(`POST /api/fallback/play/${V('f')}`, {})
    panel.calls.length = 0

    await actions.playFallbackNow(V('f'))

    assert.deepEqual(panel.calls, [`POST /api/fallback/play/${V('f')}`, 'GET /api/state'])
    assert.ok(panel.toasts().includes('Now playing: Track f'))
  })

  await t.test('"add to queue" queues it and says at which place it stands', async () => {
    panel.route(`POST /api/fallback/enqueue/${V('g')}`, {})
    panel.calls.length = 0

    await actions.enqueueFallbackTrack(V('g'))

    assert.deepEqual(panel.calls, [`POST /api/fallback/enqueue/${V('g')}`, 'GET /api/state'])
    assert.ok(panel.toasts().includes('Added to queue: Track g [#2]'))
  })

  await t.test('a track that is no longer in the list is still played or queued, without a toast that names it', async () => {
    panel.route(`POST /api/fallback/play/${V('z')}`, {})
    panel.route(`POST /api/fallback/enqueue/${V('z')}`, {})
    const before = panel.toasts().join('|')

    await actions.playFallbackNow(V('z'))
    await actions.enqueueFallbackTrack(V('z'))

    assert.equal(panel.count(`POST /api/fallback/play/${V('z')}`), 1)
    assert.equal(panel.count(`POST /api/fallback/enqueue/${V('z')}`), 1)
    assert.equal(panel.toasts().join('|'), before)
  })

  await t.test('the buttons of the rows pass the video id on', () => {
    assert.equal(typeof actions.fallbackActions['fallback-play'], 'function')
    assert.equal(typeof actions.fallbackActions['fallback-enqueue'], 'function')
  })
})
