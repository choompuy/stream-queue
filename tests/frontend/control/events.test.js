import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { setupPanel, makeTrack as track } from './panel-env.js'

const panel = setupPanel()
mock.method(console, 'log', () => {})

const { initI18n } = await import('../../../public/js/i18n.js')
await initI18n('en')
const { state } = await import('../../../public/js/control/state.js')
const { bindEvents } = await import('../../../public/js/control/events.js')
const { isDashboardActive } = await import('../../../public/js/control/tabs.js')

bindEvents()

// lets the promises that wait for a fetch answer run
const flush = () => new Promise((resolve) => setImmediate(resolve))

const click = (element) => element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
const press = (element, key) => element.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }))
const fire = (element, type) => element.dispatchEvent(new window.Event(type, { bubbles: true }))
const hidden = (selector) => panel.$(selector).classList.contains('hidden')
const active = (selector) => panel.$(selector).classList.contains('active')

panel.route('GET /api/state', { current: track('a'), queue: [], isPaused: false })
panel.route('GET /api/fallback', { upNext: [], activeVideoId: null, lastRefreshedAt: 1, sourceCount: 0, shuffle: false, repeat: false, enabled: false })
panel.route('GET /api/activity', { entries: [] })

test('the tabs', async (t) => {
  await t.test('a click on a page tab shows that page, and only it', () => {
    click(panel.$('[data-page-tab-target="settings"]'))

    assert.equal(active('[data-page-tab="settings"]'), true)
    assert.equal(active('[data-page-tab="dashboard"]'), false)
    assert.equal(active('[data-page-tab-target="settings"]'), true)
    assert.equal(active('[data-page-tab-target="dashboard"]'), false)
    assert.equal(isDashboardActive(), false)
  })

  await t.test('coming back to the dashboard reads what was not read while it was hidden', async () => {
    panel.calls.length = 0

    click(panel.$('[data-page-tab-target="dashboard"]'))
    await flush()

    assert.equal(isDashboardActive(), true)
    assert.equal(panel.count('GET /api/state'), 1)
    assert.equal(panel.count('GET /api/activity'), 1)
    assert.ok(panel.count('GET /api/fallback') >= 1, 'the playlist is read too (twice when the track changed)')
  })

  await t.test('choosing the tab that is already shown reads nothing', async () => {
    panel.calls.length = 0

    click(panel.$('[data-page-tab-target="dashboard"]'))
    await flush()

    assert.deepEqual(panel.calls, [])
  })

  await t.test('a click on a section tab shows that section, and only it', () => {
    click(panel.$('[data-section-target="activity"]'))

    assert.equal(hidden('[data-section="activity"]'), false)
    assert.equal(hidden('[data-section="queue"]'), true)
    assert.equal(active('[data-section-target="activity"]'), true)
    assert.equal(active('[data-section-target="queue"]'), false)
  })
})

test('the buttons', async (t) => {
  await t.test('a click anywhere inside an element with a data-action runs the action of that element', async () => {
    panel.route('POST /api/player/skip', {})
    panel.calls.length = 0

    click(panel.$('#skipBtn svg'))
    await flush()

    assert.deepEqual(panel.calls, ['POST /api/player/skip', 'GET /api/state'])
  })

  await t.test('a click on something that is no button does nothing', async () => {
    panel.calls.length = 0

    click(panel.$('#nowPlaying'))
    await flush()

    assert.deepEqual(panel.calls, [])
  })
})

test('the Enter key', async (t) => {
  await t.test('in the search box it searches, any other key does not', async () => {
    panel.route('GET /api/search?q=hello&admin=1', { results: [] })
    panel.$('#searchInput').value = 'hello'
    panel.calls.length = 0

    press(panel.$('#searchInput'), 'a')
    await flush()
    assert.deepEqual(panel.calls, [])

    press(panel.$('#searchInput'), 'Enter')
    await flush()
    assert.deepEqual(panel.calls, ['GET /api/search?q=hello&admin=1'])
  })

  await t.test('in the playlist box it adds the playlist', async () => {
    let sent = null
    panel.route('POST /api/playlists', (body) => {
      sent = body
      return {}
    })
    panel.route('GET /api/playlists', { playlists: [] })
    panel.$('#playlistUrlInput').value = 'PLabcdefghijklmnop'

    press(panel.$('#playlistUrlInput'), 'Enter')
    await flush()

    assert.deepEqual(sent, { playlistId: 'PLabcdefghijklmnop' })
  })
})

test('the settings inputs', async (t) => {
  await t.test('the overlay switches save at once, and "video only" is off limits while the video is hidden', async () => {
    state.settings = { showVideo: true, hideOverlayInfo: false, opacity: 100, position: 'bottom-right' }
    let sent = null
    panel.route('PUT /api/settings', (body) => {
      sent = body
      return { ...state.settings, ...body }
    })
    // the other controls show what is stored, as after loadOverlaySettings()
    panel.$('#overlayOpacity').value = '100'
    panel.$('#badgePosition').value = 'bottom-right'
    panel.$('#hideOverlayInfo').checked = false
    panel.$('#showVideo').checked = false

    fire(panel.$('#showVideo'), 'change')
    await flush()

    assert.deepEqual(sent, { showVideo: false })
    assert.equal(panel.$('#hideOverlayInfo').disabled, true)
  })

  await t.test('typing into a field takes the red mark off it, and so does choosing a value', () => {
    // the API key is not a tracked bot setting: only this handler can clear its mark
    const input = panel.$('#secYoutubeKey')

    for (const type of ['input', 'change']) {
      input.classList.add('error')
      fire(input, type)

      assert.equal(input.classList.contains('error'), false, type)
    }
  })

  await t.test('a bot setting is yellow while it differs from the stored one, and plain again when it matches', () => {
    state.config = { minViews: 10 }
    const input = panel.$('#cfgMinViews')

    input.value = '11'
    fire(input, 'input')
    assert.equal(input.classList.contains('changed'), true)

    input.value = '10'
    fire(input, 'input')
    assert.equal(input.classList.contains('changed'), false)
  })
})
