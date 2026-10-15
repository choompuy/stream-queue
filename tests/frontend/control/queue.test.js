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

  await t.test('a track that changed does not make the panel read the playlist: the server announces that itself', async () => {
    panel.route('GET /api/state', { current: track('d'), queue: [], isPaused: false })
    panel.calls.length = 0

    await queue.refreshState(true)

    assert.deepEqual(panel.calls, ['GET /api/state'])
  })

  await t.test('a failed poll leaves the state as it was', async () => {
    panel.route('GET /api/state', [500, { error: 'boom', code: 'SERVER_ERROR' }])

    await queue.refreshState(true)

    assert.equal(state.current.videoId, V('d'))
  })
})

test('renderQueue', async (t) => {
  await t.test('shows the counts, and marks the blocked track', () => {
    state.config = { maxQueueSize: 5 }
    // the server says which tracks are blocked: the panel does not match them with the list itself
    state.queue = [track('a', { isBlocked: false }), track('c', { isBlocked: true })]

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

  await t.test('removes by video id and says so: the new queue is announced by the server', async () => {
    panel.route(`DELETE /api/queue/video/${V('x')}`, {})
    panel.calls.length = 0

    await queue.removeFromQueue(V('x'))

    assert.deepEqual(panel.calls, [`DELETE /api/queue/video/${V('x')}`])
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

  await t.test('clears, and the empty queue is announced by the server', async () => {
    panel.calls.length = 0

    await queue.clearQueue()

    assert.deepEqual(panel.calls, ['POST /api/queue/clear'])
  })
})
