import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setupPanel } from './panel-env.js'

const panel = setupPanel()

const { initI18n } = await import('../../../public/js/i18n.js')
await initI18n('en')
const settings = await import('../../../public/js/control/settings.js')
const { trackForm } = await import('../../../public/js/control/form.js')

// what the server stores; a save applies to it, as the real one does
let stored = {
  minViews: 10000,
  minDurationSeconds: 60,
  maxDurationSeconds: 480,
  maxQueueSize: 20,
  maxRequestsPerUser: 4,
  allowLiveStreams: false,
  contentMode: 'music',
  regionCode: ''
}

panel.route('GET /api/config', () => ({ ...stored }))
panel.route('PUT /api/config', (body) => {
  Object.assign(stored, body)
  return { config: { ...stored }, rejected: [] }
})

// as bindEvents does, so typing marks the field
trackForm(panel.$('#botSettingsPanel'))

const field = (id) => panel.$(`#${id}`)
const marks = (id) => ['changed', 'saved', 'error'].filter((name) => field(id).classList.contains(name))
const fire = (id, type) => field(id).dispatchEvent(new window.Event(type, { bubbles: true }))

test('reading the bot settings', async (t) => {
  await t.test('fills the controls from the server', async () => {
    await settings.loadConfig()

    assert.equal(field('cfgMinViews').value, '10000')
    assert.equal(field('cfgMaxQueue').value, '20')
    assert.equal(field('cfgContentMode').value, 'music')
    assert.equal(field('cfgRegionCode').value, '')
  })

  await t.test('a field the user is typing keeps its value and its mark: an echo of the config must not wipe their work', async () => {
    field('cfgRegionCode').value = 'zz'
    fire('cfgRegionCode', 'input')
    assert.deepEqual(marks('cfgRegionCode'), ['changed'])

    // the echo of a save: the config is read again, while the field holds what the user typed
    await settings.loadConfig()

    assert.equal(field('cfgRegionCode').value, 'zz')
    assert.deepEqual(marks('cfgRegionCode'), ['changed'])
  })

  await t.test('a change made elsewhere lands in the form, and takes the mark of the field it replaces', async () => {
    stored = { ...stored, maxQueueSize: 30 }
    field('cfgMaxQueue').classList.add('saved')

    await settings.loadConfig()

    assert.equal(field('cfgMaxQueue').value, '30')
    assert.deepEqual(marks('cfgMaxQueue'), [], 'the green would tell about a save that never happened here')
  })

  await t.test('cancel still puts the stored values back and clears the marks', async () => {
    field('cfgRegionCode').value = 'DE'
    fire('cfgRegionCode', 'input')

    settings.cancelConfigChanges()

    assert.equal(field('cfgRegionCode').value, '')
    assert.deepEqual(marks('cfgRegionCode'), [])
  })
})

test('saving the bot settings', async (t) => {
  await settings.loadConfig()

  await t.test('the mark of a saved field survives the echo of the save', async () => {
    field('cfgMinViews').value = '15000'

    await settings.saveConfigSetting()

    assert.deepEqual(marks('cfgMinViews'), ['saved'])
    assert.ok(panel.toasts().includes('Settings saved'))

    // the echo of the save arrives and reads the config: the mark must not vanish at once
    await settings.loadConfig()

    assert.equal(field('cfgMinViews').value, '15000')
    assert.deepEqual(marks('cfgMinViews'), ['saved'])
  })

  await t.test('a refused field keeps what was typed, through the echo as well', async () => {
    panel.route('PUT /api/config', () => ({ config: { ...stored }, rejected: ['regionCode'] }))
    field('cfgRegionCode').value = 'zz'

    await settings.saveConfigSetting()

    assert.equal(field('cfgRegionCode').value, 'zz')
    assert.deepEqual(marks('cfgRegionCode'), ['error'])
    assert.ok(panel.toasts().includes('Saved 0, not saved 1 (invalid values)'))

    await settings.loadConfig()

    assert.equal(field('cfgRegionCode').value, 'zz')
    assert.deepEqual(marks('cfgRegionCode'), ['error'])
  })
})
