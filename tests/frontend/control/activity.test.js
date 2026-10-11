import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setupPanel, V } from './panel-env.js'

const panel = setupPanel()

const { initI18n } = await import('../../../public/js/i18n.js')
await initI18n('en')
const { loadActivity } = await import('../../../public/js/control/activity.js')

let at = 1_000
const entry = (char, extra = {}) => ({ at: ++at, videoId: V(char), title: `Song ${char}`, query: 'q', status: 'accepted', requestedBy: 'amy', reasonCode: null, ...extra })

let entries = []
panel.route('GET /api/activity', () => ({ entries }))

const load = async () => {
  await loadActivity(true)
  return panel.toasts().join('|')
}

test('requests from viewers', async (t) => {
  const seen = entry('a')

  await t.test('what is already there when the panel opens is not announced', async () => {
    entries = [seen]

    assert.equal(await load(), '')
  })

  await t.test('one new accepted request is announced with its viewer and title', async () => {
    entries = [entry('b'), seen]
    await load()

    assert.ok(panel.toasts().includes('🎵 amy added: Song b'))
  })

  await t.test('several at once are announced as a count', async () => {
    entries = [entry('c'), entry('d', { requestedBy: 'bob' }), ...entries]
    await load()

    assert.ok(panel.toasts().includes('🎵 2 new tracks added by viewers'))
  })

  await t.test('the same entries are not announced again', async () => {
    const before = await load()

    assert.equal(await load(), before)
  })

  await t.test('requests made in the panel, refused ones and failed playbacks are not announced', async () => {
    const before = await load()
    entries = [
      entry('e', { requestedBy: 'ControlPanel' }),
      entry('f', { status: 'rejected', reasonCode: 'DUPLICATE' }),
      entry('g', { status: 'failed', reasonCode: 'PLAYBACK_FAILED' }),
      ...entries
    ]

    assert.equal(await load(), before)
  })
})
