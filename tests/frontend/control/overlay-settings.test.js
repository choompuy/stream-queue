import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setupPanel } from './panel-env.js'

// the panel is opened by the LAN address of the computer, as it is from a phone or another PC
const panel = setupPanel({ url: 'http://192.168.0.2:4747/' })

const { initI18n } = await import('../../../public/js/i18n.js')
await initI18n('en')
const { state } = await import('../../../public/js/control/state.js')
const settings = await import('../../../public/js/control/settings.js')

const stored = { showVideo: true, hideOverlayInfo: false, opacity: 100, position: 'bottom-right' }
let puts = []
panel.route('GET /api/settings', () => ({ ...stored }))
panel.route('PUT /api/settings', (body) => {
  puts.push(body)
  return { ...stored, ...body }
})

const field = (id) => panel.$(`#${id}`)
const hasError = (id) => field(id).classList.contains('error')

test('loading the overlay settings', async (t) => {
  await t.test('fills the controls from the server', async () => {
    await settings.loadOverlaySettings()

    assert.equal(field('showVideo').checked, true)
    assert.equal(field('overlayOpacity').value, '100')
    assert.equal(field('badgePosition').value, 'bottom-right')
    assert.equal(field('hideOverlayInfo').disabled, false)
  })

  await t.test('"video only" cannot be chosen while the video is hidden', async () => {
    panel.route('GET /api/settings', { ...stored, showVideo: false, hideOverlayInfo: true, opacity: 40, position: 'top-left' })

    await settings.loadOverlaySettings()

    assert.equal(field('showVideo').checked, false)
    assert.equal(field('hideOverlayInfo').checked, true)
    assert.equal(field('hideOverlayInfo').disabled, true)
    assert.equal(field('overlayOpacity').value, '40')
    assert.equal(field('badgePosition').value, 'top-left')
  })

  await t.test('the OBS link says localhost even though the panel was opened by the LAN address', () => {
    assert.equal(field('overlayUrl').href, 'http://localhost:4747/overlay')
    assert.equal(field('overlayUrl').textContent, 'http://localhost:4747/overlay')
  })
})

test('saving the overlay settings', async (t) => {
  panel.route('GET /api/settings', { ...stored })
  await settings.loadOverlaySettings()

  await t.test('nothing is sent when nothing changed', async () => {
    puts = []

    await settings.saveOverlaySettings()

    assert.deepEqual(puts, [])
  })

  await t.test('only the changed fields are sent, and the answer of the server becomes the state', async () => {
    field('overlayOpacity').value = '55'

    await settings.saveOverlaySettings()

    assert.deepEqual(puts, [{ opacity: 55 }])
    assert.equal(state.settings.opacity, 55)
  })

  await t.test('an opacity that is not a number is marked and not sent', async () => {
    puts = []
    field('overlayOpacity').value = ''

    await settings.saveOverlaySettings()

    assert.deepEqual(puts, [])
    assert.equal(hasError('overlayOpacity'), true)
  })

  await t.test('a field the server refuses is marked, the state stays, and the error is shown', async () => {
    field('overlayOpacity').value = '70'
    panel.route('PUT /api/settings', [400, { error: 'raw', code: 'INVALID_SETTINGS', params: { fields: 'opacity' } }])

    await settings.saveOverlaySettings()

    assert.equal(hasError('overlayOpacity'), true)
    assert.equal(hasError('showVideo'), false)
    assert.equal(state.settings.opacity, 55)
    assert.ok(panel.toasts().includes('Invalid overlay settings: opacity'))
  })
})
