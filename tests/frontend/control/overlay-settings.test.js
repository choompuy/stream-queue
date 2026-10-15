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
const puts = []
panel.route('GET /api/settings', () => ({ ...stored }))
panel.route('PUT /api/settings', (body) => {
  puts.push(body)
  Object.assign(stored, body)
  return { config: { ...stored }, rejected: [] }
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

  await t.test('sends only what changed, and the answer of the server becomes the state', async () => {
    field('overlayOpacity').value = '55'

    await settings.saveOverlaySettings()

    assert.deepEqual(puts.at(-1), { opacity: 55 }, 'what another panel may have changed meanwhile is not sent back')
    assert.equal(state.settings.opacity, 55)
    assert.equal(field('overlayOpacity').classList.contains('saved'), true)
    assert.equal(field('showVideo').classList.contains('saved'), false, 'only what changed is marked')
    assert.equal(panel.toasts().includes('Settings saved'), false, 'an autosave is silent: the green mark is enough')
  })

  await t.test('an empty opacity is sent as it is, and the server refusing it marks the field', async () => {
    panel.route('PUT /api/settings', (body) => {
      puts.push(body)
      return [400, { error: 'raw', code: 'INVALID_CONFIG', params: { fields: 'opacity' }, data: { config: { ...stored }, rejected: ['opacity'] } }]
    })
    field('overlayOpacity').value = ''

    await settings.saveOverlaySettings()

    assert.equal(puts.at(-1).opacity, null)
    assert.equal(hasError('overlayOpacity'), true)
    assert.equal(hasError('showVideo'), false)
    assert.equal(state.settings.opacity, 55, 'the stored settings are still the old ones')
    assert.ok(panel.toasts().includes('Saved 0, not saved 1 (invalid values)'))
  })

  await t.test('what is stored shows on the controls again, the refused field keeps what was typed', async () => {
    assert.equal(field('overlayOpacity').value, '')
    assert.equal(field('badgePosition').value, 'bottom-right')
  })
})
