import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setupPanel, V } from './panel-env.js'

const panel = setupPanel()

const { initI18n } = await import('../../../public/js/i18n.js')
await initI18n('en')
const { state } = await import('../../../public/js/control/state.js')
const { loadActivity } = await import('../../../public/js/control/activity.js')

let at = 1_000
const entry = (char, extra = {}) => ({ at: ++at, videoId: V(char), title: `Song ${char}`, query: 'q', status: 'accepted', requestedBy: 'amy', reasonCode: null, ...extra })

test('loadActivity()', async (t) => {
  await t.test('shows the entries and their count on the tab, and never a toast about them: that is for the notices of the server', async () => {
    panel.route('GET /api/activity', { entries: [entry('a'), entry('b', { status: 'rejected', reasonCode: 'DUPLICATE' })] })
    const before = panel.toasts().join('|')

    await loadActivity()

    assert.equal(state.activity.length, 2)
    assert.equal(panel.$('#tabActivityCount').textContent, '2')
    assert.equal(panel.$('#activityCount').textContent, 'Requests: 2')
    assert.equal(panel.$$('#activityListWrapper .row-item').length, 2)
    assert.equal(panel.toasts().join('|'), before)
  })

  await t.test('a new entry is shown without a toast, even from a viewer', async () => {
    panel.route('GET /api/activity', { entries: [entry('c'), entry('a')] })
    const before = panel.toasts().join('|')

    await loadActivity(true)

    assert.equal(panel.toasts().join('|'), before)
  })

  await t.test('a silent read that fails says nothing and leaves the list as it was', async () => {
    panel.route('GET /api/activity', [500, { error: 'raw', code: 'SERVER_ERROR' }])
    const before = panel.toasts().join('|')

    await loadActivity(true)

    assert.equal(panel.toasts().join('|'), before)
    assert.equal(state.activity.length, 2)
  })
})
