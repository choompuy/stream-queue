import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setupPanel, makeTrack as track, V, act } from './panel-env.js'

const panel = setupPanel()

const { initI18n } = await import('../../../public/js/i18n.js')
await initI18n('en')
const { state } = await import('../../../public/js/control/state.js')
const queue = await import('../../../public/js/control/queue.js')

const fallbackAnswer = { upNext: [track('e')], activeVideoId: null, lastRefreshedAt: Date.now(), sourceCount: 1, shuffle: false, repeat: false, enabled: true }

test('readState (the state topic)', async (t) => {
  panel.route('GET /api/fallback', fallbackAnswer)

  await t.test('writes the answer to the store, and only the state is read: the playlist is announced by the server', async () => {
    panel.route('GET /api/state', { current: track('d'), queue: [track('a')], isPaused: false })
    panel.calls.length = 0

    await queue.readState()

    assert.deepEqual(panel.calls, ['GET /api/state'])
    assert.equal(state.current.videoId, V('d'))
    assert.equal(state.queue.length, 1)
  })

  await t.test('a failed read rejects (the watcher logs it) and leaves the state as it was', async () => {
    panel.route('GET /api/state', [500, { error: 'boom', code: 'SERVER_ERROR' }])

    await assert.rejects(queue.readState())

    assert.equal(state.current.videoId, V('d'))
  })

  await t.test('reads of one topic never overlap and the older answer is dropped: the watcher reads through serialized', async () => {
    // the guarantee is the watcher's (see watch.js and wiring.test.js); this is the half of it that lives in the store:
    // the answer that arrives is written at once, whole
    panel.route('GET /api/state', { current: track('b'), queue: [], isPaused: false })

    await queue.readState()

    assert.equal(state.current.videoId, V('b'))
    assert.equal(state.queue.length, 0)
  })
})

test('renderQueue', async (t) => {
  await t.test('shows the counts, and marks the blocked track', () => {
    state.config = { maxQueueSize: 5 }
    // the server says which tracks are blocked: the panel does not match them with the list itself
    state.queue = [track('a', { isBlocked: false }), track('c', { isBlocked: true })]

    queue.renderQueue()

    assert.equal(panel.$('#queueCount').textContent, 'In queue: 2 ▪ limit 5')
    assert.equal(panel.$('#tabQueueCount').textContent, '2')

    const rows = panel.$$('#queueListWrapper .row-item')
    assert.equal(rows.length, 2)
    assert.equal(rows[0].querySelector('.status-pill'), null)
    assert.ok(rows[1].querySelector('.status-pill'))
  })

  await t.test('an empty queue says so in words: a bare 0/0 tells nobody anything', () => {
    state.config = { maxQueueSize: 5 }
    state.queue = []

    queue.renderQueue()

    assert.equal(panel.$('#queueCount').textContent, 'In queue: 0 ▪ limit 5')

    state.config = { maxQueueSize: 0 }
    queue.renderQueue()
    assert.equal(panel.$('#queueCount').textContent, 'Queue is empty')
  })

  await t.test('a playlist track goes by the localized name, and follows the panel\'s language', async () => {
    state.config = { maxQueueSize: 5 }
    state.queue = [track('a', { isFallback: true, requestedBy: 'playlist' })]

    queue.renderQueue()
    assert.equal(panel.$('#queueListWrapper .column-requested-by').textContent.trim(), 'Playlist')

    // the track still carries the same marker: only the language changed, and the row shows it
    await initI18n('ru')
    queue.renderQueue()
    assert.equal(panel.$('#queueListWrapper .column-requested-by').textContent.trim(), 'Плейлист')

    await initI18n('en')
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

    await act(queue.removeFromQueue, V('y'))

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
