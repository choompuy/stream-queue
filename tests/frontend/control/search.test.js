import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setupPanel, deferred, makeTrack as track, V } from './panel-env.js'

const panel = setupPanel()

const { initI18n } = await import('../../../public/js/i18n.js')
await initI18n('en')
const { state } = await import('../../../public/js/control/state.js')
const { search, clearSearchResults, searchActions } = await import('../../../public/js/control/search.js')

const input = panel.$('#searchInput')
const results = () => panel.$$('#searchListWrapper .row-item')
const wrapperHidden = () => panel.$('#searchListWrapper').classList.contains('hidden')

state.current = track('a')
panel.route('GET /api/state', { current: track('a'), queue: [], isPaused: false })
panel.route('GET /api/activity', { entries: [] })

test('search', async (t) => {
  await t.test('an empty box sends nothing', async () => {
    input.value = '   '

    await search()

    assert.deepEqual(panel.calls, [])
  })

  await t.test('a text is searched for and the results are listed', async () => {
    panel.route('GET /api/search?q=hello%20world&admin=1', { results: [track('b'), track('c')] })
    input.value = '  hello world '

    await search()

    assert.equal(results().length, 2)
    assert.equal(wrapperHidden(), false)
  })

  await t.test('a second search while the first is still running is ignored', async () => {
    const answer = deferred()
    panel.route('GET /api/search?q=slow&admin=1', () => answer.promise)
    panel.calls.length = 0
    input.value = 'slow'

    const first = search()
    const second = search()
    answer.resolve({ results: [] })
    await Promise.all([first, second])

    assert.equal(panel.count('GET /api/search?q=slow&admin=1'), 1)
  })

  await t.test('after a failed search the next one is sent', async () => {
    panel.route('GET /api/search?q=broken&admin=1', [500, { error: 'boom', code: 'SERVER_ERROR' }])
    panel.calls.length = 0
    input.value = 'broken'

    await search()
    await search()

    assert.equal(panel.count('GET /api/search?q=broken&admin=1'), 2)
    assert.ok(panel.toasts().includes('Internal server error'))
  })
})

test('adding a track', async (t) => {
  let sent = null
  panel.route('POST /api/queue/request', (body) => {
    sent = body
    return { song: { title: 'Song' }, position: 3, started: false }
  })

  await t.test('a YouTube link in the box is queued instead of searched, as the panel and with the admin rules', async () => {
    input.value = 'https://youtu.be/dQw4w9WgXcQ'
    panel.calls.length = 0

    await search()

    assert.deepEqual(sent, { query: 'https://youtu.be/dQw4w9WgXcQ', requestedBy: 'ControlPanel', admin: true })
    assert.deepEqual(panel.calls, ['POST /api/queue/request', 'GET /api/state', 'GET /api/activity'])
    assert.ok(panel.toasts().includes('Added to queue: Song [#3]'))
  })

  await t.test('a track that starts playing at once is announced as playing', async () => {
    panel.route('POST /api/queue/request', { song: { title: 'Song' }, position: 1, started: true })

    await searchActions['search-add']({ dataset: { videoId: V('z') } })

    assert.ok(panel.toasts().includes('Now playing: Song'))
  })

  await t.test('the + button of a result queues the watch link of that video', async () => {
    panel.route('POST /api/queue/request', (body) => {
      sent = body
      return { song: { title: 'Song' }, position: 2, started: false }
    })

    await searchActions['search-add']({ dataset: { videoId: V('z') } })

    assert.equal(sent.query, `https://www.youtube.com/watch?v=${V('z')}`)
  })

  await t.test('a refused request is reported, and the activity is reloaded to show the refusal', async () => {
    panel.route('POST /api/queue/request', [409, { error: 'raw', code: 'DUPLICATE' }])
    panel.calls.length = 0

    await searchActions['search-add']({ dataset: { videoId: V('z') } })

    assert.deepEqual(panel.calls, ['POST /api/queue/request', 'GET /api/activity'])
    assert.ok(panel.toasts().includes('This track is already in the queue'))
  })
})

test('clearSearchResults', async (t) => {
  await t.test('empties the box and the list and hides the list', () => {
    input.value = 'something'
    panel.route('GET /api/search?q=something&admin=1', { results: [] })

    clearSearchResults()

    assert.equal(input.value, '')
    assert.equal(results().length, 0)
    assert.equal(wrapperHidden(), true)
  })
})
