import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setupPanel, deferred, makeTrack as track, V } from './panel-env.js'

const panel = setupPanel()

const { initI18n } = await import('../../../public/js/i18n.js')
await initI18n('en')
const { state } = await import('../../../public/js/control/state.js')
const queue = await import('../../../public/js/control/queue.js')

const fallbackAnswer = { upNext: [track('e')], activeVideoId: null, lastRefreshedAt: Date.now(), sourceCount: 1, shuffle: false, repeat: false, enabled: true }

test('refreshState', async (t) => {
  panel.route('GET /api/fallback', fallbackAnswer)

  await t.test('an answer that arrives after a newer request was sent is dropped', async () => {
    const older = deferred()
    const newer = deferred()
    const answers = [older, newer]
    panel.route('GET /api/state', () => answers.shift().promise)

    const first = queue.refreshState(true)
    const second = queue.refreshState(true)

    newer.resolve({ current: track('b'), queue: [], isPaused: false })
    await second
    older.resolve({ current: track('a'), queue: [track('c')], isPaused: false })
    await first

    assert.equal(state.current.videoId, V('b'))
    assert.equal(state.queue.length, 0)
  })

  await t.test('the fallback playlist is reloaded when the track changed, not on every poll', async () => {
    panel.route('GET /api/state', { current: track('d'), queue: [], isPaused: false })
    panel.calls.length = 0

    await queue.refreshState(true)
    assert.equal(panel.count('GET /api/fallback'), 1)

    await queue.refreshState(true)
    assert.equal(panel.count('GET /api/fallback'), 1)
  })

  await t.test('a failed poll leaves the state as it was', async () => {
    panel.route('GET /api/state', [500, { error: 'boom', code: 'SERVER_ERROR' }])

    await queue.refreshState(true)

    assert.equal(state.current.videoId, V('d'))
  })

  await t.test('a missing queue, pause flag and next track fall back to empty values', async () => {
    panel.route('GET /api/state', { current: null })

    await queue.refreshState(true)

    assert.deepEqual([state.current, state.queue, state.isPaused, state.nextTrack], [null, [], false, null])
  })
})

test('renderQueue', async (t) => {
  await t.test('shows the counts, and marks the blocked track', () => {
    state.config = { maxQueueSize: 5 }
    state.queue = [track('a'), track('c')]
    state.blocklist = [{ videoId: V('c'), title: 'Track c', blockedAt: 1 }]

    queue.renderQueue()

    assert.equal(panel.$('#queueCount').textContent, '2/5')
    assert.equal(panel.$('#tabQueueCount').textContent, '2')

    const rows = panel.$$('#queueListWrapper .row-item')
    assert.equal(rows.length, 2)
    assert.equal(rows[0].querySelector('.status-pill'), null)
    assert.ok(rows[1].querySelector('.status-pill'))
  })
})

test('removeFromQueue', async (t) => {
  state.current = track('d')
  panel.route('GET /api/state', { current: track('d'), queue: [], isPaused: false })

  await t.test('removes by video id, then reloads the queue and says so', async () => {
    panel.route(`DELETE /api/queue/video/${V('x')}`, {})
    panel.calls.length = 0

    await queue.removeFromQueue(V('x'))

    assert.deepEqual(panel.calls, [`DELETE /api/queue/video/${V('x')}`, 'GET /api/state'])
    assert.ok(panel.toasts().includes('Removed from queue'))
  })

  await t.test('a track that is already gone is reported, and nothing is reloaded or announced as removed', async () => {
    panel.route(`DELETE /api/queue/video/${V('y')}`, [404, { error: 'raw', code: 'QUEUE_ITEM_NOT_FOUND' }])
    panel.calls.length = 0

    await queue.removeFromQueue(V('y'))

    assert.deepEqual(panel.calls, [`DELETE /api/queue/video/${V('y')}`])
    assert.ok(panel.toasts().includes('Queue item not found'))
  })
})

test('clearQueue', async (t) => {
  state.current = track('d')
  panel.route('GET /api/state', { current: track('d'), queue: [], isPaused: false })
  panel.route('POST /api/queue/clear', {})

  await t.test('does nothing when the question is answered with no', async () => {
    globalThis.confirm = () => false
    panel.calls.length = 0

    await queue.clearQueue()

    assert.deepEqual(panel.calls, [])
  })

  await t.test('clears and reloads when it is answered with yes', async () => {
    globalThis.confirm = () => true
    panel.calls.length = 0

    await queue.clearQueue()

    assert.deepEqual(panel.calls, ['POST /api/queue/clear', 'GET /api/state'])
  })
})
