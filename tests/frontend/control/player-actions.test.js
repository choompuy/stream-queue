import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setupPanel, deferred, makeTrack as track } from './panel-env.js'

const panel = setupPanel()

const { initI18n } = await import('../../../public/js/i18n.js')
await initI18n('en')
const { state } = await import('../../../public/js/control/state.js')
const { playPauseCurrent, skipCurrent, playerActions } = await import('../../../public/js/control/player-actions.js')

state.current = track('a')
panel.route('GET /api/state', { current: track('a'), queue: [], isPaused: false })
panel.route('POST /api/player/pause', {})
panel.route('POST /api/player/resume', {})
panel.route('POST /api/player/skip', {})

test('play and pause', async (t) => {
  await t.test('pauses what is playing, then reads the state', async () => {
    state.isPaused = false
    panel.calls.length = 0

    await playPauseCurrent()

    assert.deepEqual(panel.calls, ['POST /api/player/pause', 'GET /api/state'])
  })

  await t.test('resumes what is paused, then reads the state', async () => {
    state.isPaused = true
    panel.calls.length = 0

    await playPauseCurrent()

    assert.deepEqual(panel.calls, ['POST /api/player/resume', 'GET /api/state'])
  })

  await t.test('the button waits for the answer, so a second click cannot send the opposite command', async () => {
    const answer = deferred()
    panel.route('POST /api/player/pause', () => answer.promise)
    state.isPaused = false
    const button = panel.$('#playPauseBtn')

    const pending = playPauseCurrent()
    assert.equal(button.disabled, true)

    answer.resolve({})
    await pending
    assert.equal(button.disabled, false)
  })

  await t.test('a refused command is reported and the state is not read as if it had worked', async () => {
    panel.route('POST /api/player/pause', [500, { error: 'raw', code: 'SERVER_ERROR' }])
    state.isPaused = false
    panel.calls.length = 0

    await playPauseCurrent()

    assert.deepEqual(panel.calls, ['POST /api/player/pause'])
    assert.ok(panel.toasts().includes('Internal server error'))
    assert.equal(panel.$('#playPauseBtn').disabled, false)
  })
})

test('skip', async (t) => {
  await t.test('skips, then reads the state', async () => {
    panel.calls.length = 0

    await skipCurrent()

    assert.deepEqual(panel.calls, ['POST /api/player/skip', 'GET /api/state'])
  })

  await t.test('the two buttons are wired to the two actions', () => {
    assert.equal(playerActions['resume-pause'], playPauseCurrent)
    assert.equal(playerActions.skip, skipCurrent)
  })
})
