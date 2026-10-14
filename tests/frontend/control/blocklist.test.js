import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setupPanel, V } from './panel-env.js'

const panel = setupPanel()

const { initI18n } = await import('../../../public/js/i18n.js')
await initI18n('en')
const { state } = await import('../../../public/js/control/state.js')
const { loadBlocklist, blockTrack, unblockTrack, blocklistActions } = await import('../../../public/js/control/blocklist.js')

const entry = (char) => ({ videoId: V(char), title: `Track ${char}`, blockedAt: 1 })

test('loadBlocklist', async (t) => {
  await t.test('shows the list and the count on its tab', async () => {
    panel.route('GET /api/blocklist', { entries: [entry('a'), entry('b')] })

    await loadBlocklist()

    assert.equal(state.blocklist.length, 2)
    assert.equal(panel.$$('#blocklistListWrapper .row-item').length, 2)
    assert.equal(panel.$('#tabBlocklistCount').textContent, '2')
  })

  await t.test('a silent read that fails says nothing', async () => {
    panel.route('GET /api/blocklist', [500, { error: 'raw', code: 'SERVER_ERROR' }])
    const before = panel.toasts().join('|')

    await loadBlocklist(true)

    assert.equal(panel.toasts().join('|'), before)
    assert.equal(state.blocklist.length, 2, 'the list stays as it was')
  })
})

test('blocking and unblocking', async (t) => {
  await t.test('is only the request and the toast: what changed in the list, the queue and the playlist is announced by the server', async () => {
    panel.route(`POST /api/blocklist`, { entry: entry('a'), skipped: false })
    panel.route(`DELETE /api/blocklist/${V('a')}`, { removed: true })
    panel.calls.length = 0

    await blockTrack(V('a'), 'Track a')
    assert.deepEqual(panel.calls, ['POST /api/blocklist'])
    assert.ok(panel.toasts().includes('Track blocked'))

    panel.calls.length = 0
    await unblockTrack(V('a'))
    assert.deepEqual(panel.calls, [`DELETE /api/blocklist/${V('a')}`])
    assert.ok(panel.toasts().includes('Track unblocked'))
  })

  await t.test('the buttons pass the id and the title of the row on', async () => {
    let sent = null
    panel.route('POST /api/blocklist', (body) => {
      sent = body
      return { entry: entry('b'), skipped: false }
    })

    await blocklistActions['block-track']({ dataset: { videoId: V('b'), title: 'Track b' } })

    assert.deepEqual(sent, { videoId: V('b'), title: 'Track b' })
  })

  await t.test('a refused request is reported and nothing is announced as blocked', async () => {
    panel.route('POST /api/blocklist', [400, { error: 'raw', code: 'INVALID_VIDEO_ID' }])
    document.getElementById('toastContainer').innerHTML = ''

    await blockTrack('nope', 'x')

    assert.equal(panel.toasts().includes('Track blocked'), false)
    assert.ok(panel.toasts().includes('Invalid video ID'))
  })
})
