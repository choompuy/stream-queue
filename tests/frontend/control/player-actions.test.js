import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setupPanel, deferred, makeTrack as track, act } from './panel-env.js'

const panel = setupPanel()

const { initI18n } = await import('../../../public/js/i18n.js')
await initI18n('en')
const { state } = await import('../../../public/js/control/state.js')
const { playPauseCurrent, skipCurrent, playerActions } = await import('../../../public/js/control/player-actions.js')
const { dispatchAction } = await import('../../../public/js/control/actions.js')

state.current = track('a')
panel.route('GET /api/state', { current: track('a'), queue: [], isPaused: false })
panel.route('POST /api/player/pause', {})
panel.route('POST /api/player/resume', {})
panel.route('POST /api/player/skip', {})

test('play and pause', async (t) => {
  await t.test('pauses what is playing', async () => {
    state.isPaused = false
    panel.calls.length = 0

    await playPauseCurrent()

    assert.deepEqual(panel.calls, ['POST /api/player/pause'])
  })

  await t.test('resumes what is paused', async () => {
    state.isPaused = true
    panel.calls.length = 0

    await playPauseCurrent()

    assert.deepEqual(panel.calls, ['POST /api/player/resume'])
  })

  await t.test('the button waits for the answer, so a second click cannot send the opposite command', async () => {
    const answer = deferred()
    panel.route('POST /api/player/pause', () => answer.promise)
    state.isPaused = false
    const button = panel.$('#playPauseBtn')

    const pending = dispatchAction(button, new window.Event('click'))
    assert.equal(button.disabled, true)

    answer.resolve({})
    await pending
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(button.disabled, false)
  })

  await t.test('a refused command is reported', async () => {
    panel.route('POST /api/player/pause', [500, { error: 'raw', code: 'SERVER_ERROR' }])
    state.isPaused = false
    panel.calls.length = 0

    await act(playPauseCurrent)

    assert.deepEqual(panel.calls, ['POST /api/player/pause'])
    assert.ok(panel.toasts().includes('Internal server error'))
    assert.equal(panel.$('#playPauseBtn').disabled, false)
  })
})

test('skip', async (t) => {
  await t.test('skips', async () => {
    panel.calls.length = 0

    await skipCurrent()

    assert.deepEqual(panel.calls, ['POST /api/player/skip'])
  })

  await t.test('the two buttons are wired to the two actions', () => {
    assert.equal(playerActions['resume-pause'], playPauseCurrent)
    assert.equal(playerActions.skip, skipCurrent)
  })
})
