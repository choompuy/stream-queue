import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const jsdom = new JSDOM(readFileSync(new URL('../../../public/index.html', import.meta.url), 'utf8').replace(/<script[^>]*><\/script>/g, ''))

globalThis.window = jsdom.window
globalThis.document = jsdom.window.document

// requests the control panel makes, keyed by "METHOD path"; the handler's result is the `data` of the answer
let handlers = {}
let requests = []
let bodies = {}

globalThis.fetch = async (url, options = {}) => {
  const key = `${options.method ?? 'GET'} ${url}`
  requests.push(key)
  if (options.body) bodies[key] = JSON.parse(options.body)

  if (url.startsWith('/locales/')) return { ok: true, json: async () => ({}) }

  const handler = handlers[key]
  assert.ok(handler, `unexpected request ${key}`)

  const result = await handler()
  return { ok: true, status: 200, json: async () => ({ data: result }) }
}

// the answer of a save that the server refuses for some fields: a success that names them in `rejected`
const refusal = (rejected) => ({ config: {}, rejected })

const { state } = await import('../../../public/js/control/state.js')
const { showRewardForm, bindRewardForm } = await import('../../../public/js/control/twitch/twitch-reward-form.js')
const { saveReward, cancelRewardChanges, bindTwitchRewardTracking } = await import('../../../public/js/control/twitch/twitch-rewards.js')

bindRewardForm()
bindTwitchRewardTracking()

const reward = (over = {}) => ({
  id: 'rw1',
  title: 'Song request',
  cost: 500,
  prompt: 'Paste a link',
  backgroundColor: '#9147FF',
  isEnabled: true,
  limits: {
    maxPerStream: { enabled: true, value: 5 },
    maxPerUserPerStream: { enabled: false, value: null },
    globalCooldownSeconds: { enabled: true, value: 60 }
  },
  ...over
})

const field = (id) => document.getElementById(id)
const has = (id, name) => field(id).classList.contains(name)
const type = (id, value) => {
  field(id).value = value
  field(id).dispatchEvent(new jsdom.window.Event('input', { bubbles: true }))
}
const toggle = (id, checked) => {
  field(id).checked = checked
  field(id).dispatchEvent(new jsdom.window.Event('change', { bubbles: true }))
}
const toasts = () => document.getElementById('toastContainer').textContent

const INPUTS = [
  'twitchRewardTitle',
  'twitchRewardCost',
  'twitchRewardPrompt',
  'twitchRewardBackgroundColor',
  'twitchRewardEnabled',
  'twitchMaxPerStreamEnabled',
  'twitchMaxPerStream',
  'twitchMaxPerUserPerStreamEnabled',
  'twitchMaxPerUserPerStream',
  'twitchGlobalCooldownEnabled',
  'twitchGlobalCooldownSeconds'
]

function reset() {
  handlers = {}
  requests = []
  bodies = {}
  state.twitch.rewards = []
  state.twitch.selectedRewardId = ''
  state.twitch.config = null
  document.getElementById('toastContainer').innerHTML = ''
  showRewardForm()
}

test('showRewardForm()', async (t) => {
  t.beforeEach(reset)

  await t.test('blank: an empty enabled reward with every limit off and its number locked', () => {
    assert.equal(field('twitchRewardTitle').value, '')
    assert.equal(field('twitchRewardCost').value, '')
    assert.equal(field('twitchRewardEnabled').checked, true)
    for (const id of ['twitchMaxPerStream', 'twitchMaxPerUserPerStream', 'twitchGlobalCooldownSeconds']) {
      assert.equal(field(id).disabled, true, id)
      assert.equal(field(id).value, '', id)
    }
    assert.equal(state.twitch.editingReward, null)
  })

  await t.test('with a reward: fills the fields, unlocks the limits that are on and leaves the others empty and locked', () => {
    showRewardForm(reward())

    assert.equal(field('twitchRewardTitle').value, 'Song request')
    assert.equal(field('twitchRewardCost').value, '500')
    assert.equal(field('twitchRewardPrompt').value, 'Paste a link')
    assert.equal(field('twitchRewardBackgroundColor').value, '#9147FF')
    assert.equal(field('twitchMaxPerStreamEnabled').checked, true)
    assert.equal(field('twitchMaxPerStream').value, '5')
    assert.equal(field('twitchMaxPerStream').disabled, false)
    assert.equal(field('twitchMaxPerUserPerStreamEnabled').checked, false)
    assert.equal(field('twitchMaxPerUserPerStream').disabled, true)
    assert.equal(field('twitchGlobalCooldownSeconds').value, '60')
  })

  await t.test('the heading says whether a reward is edited or created, and the reward being edited is kept for the save', () => {
    const heading = () => field('twitchRewardForm').querySelector('h2').textContent

    showRewardForm(reward())
    const edited = heading()
    assert.equal(state.twitch.editingReward.id, 'rw1')

    showRewardForm()
    assert.notEqual(heading(), edited)
  })

  await t.test('clears every changed, saved and error mark', () => {
    for (const id of INPUTS) field(id).classList.add('changed', 'saved', 'error')

    showRewardForm(reward())

    assert.deepEqual(INPUTS.filter((id) => ['changed', 'saved', 'error'].some((name) => has(id, name))), [])
  })
})

test('the limit toggles', async (t) => {
  t.beforeEach(reset)

  await t.test('turning a limit on unlocks its number, turning it off locks and empties it', () => {
    toggle('twitchMaxPerStreamEnabled', true)
    assert.equal(field('twitchMaxPerStream').disabled, false)

    type('twitchMaxPerStream', '7')
    toggle('twitchMaxPerStreamEnabled', false)
    assert.equal(field('twitchMaxPerStream').disabled, true)
    assert.equal(field('twitchMaxPerStream').value, '')
  })
})

test('changed marks', async (t) => {
  t.beforeEach(reset)

  await t.test('an input of an edited reward is marked while it differs from what Twitch has, and cleared when it matches again', () => {
    showRewardForm(reward())

    type('twitchRewardTitle', 'Other')
    assert.ok(has('twitchRewardTitle', 'changed'))

    type('twitchRewardTitle', 'Song request')
    assert.equal(has('twitchRewardTitle', 'changed'), false)
  })

  await t.test('checkboxes are marked too, and so is a limit that is turned off with its number', () => {
    showRewardForm(reward())

    toggle('twitchRewardEnabled', false)
    assert.ok(has('twitchRewardEnabled', 'changed'))

    toggle('twitchGlobalCooldownEnabled', false)
    assert.ok(has('twitchGlobalCooldownEnabled', 'changed'))
    assert.ok(has('twitchGlobalCooldownSeconds', 'changed'), 'its number was emptied')
  })
})

test('cancelRewardChanges()', async (t) => {
  t.beforeEach(reset)

  await t.test('puts the stored reward back and clears the marks', () => {
    showRewardForm(reward())
    type('twitchRewardTitle', 'Typed')

    cancelRewardChanges()

    assert.equal(field('twitchRewardTitle').value, 'Song request')
    assert.equal(has('twitchRewardTitle', 'changed'), false)
  })

  await t.test('while a new reward is being made it empties the form', () => {
    type('twitchRewardTitle', 'Typed')

    cancelRewardChanges()

    assert.equal(field('twitchRewardTitle').value, '')
  })
})

test('saveReward()', async (t) => {
  t.beforeEach(reset)

  await t.test('sends the form as it is typed, in the shape of the reward: the checking is the server\'s', async () => {
    handlers = { 'POST /api/integrations/twitch/rewards': () => refusal(['title', 'cost']) }
    type('twitchRewardTitle', '  Song  ')
    type('twitchRewardCost', '')
    toggle('twitchMaxPerStreamEnabled', true)
    type('twitchMaxPerStream', '3')

    await saveReward()

    assert.deepEqual(bodies['POST /api/integrations/twitch/rewards'], {
      title: 'Song',
      cost: null,
      prompt: '',
      backgroundColor: '',
      isEnabled: true,
      limits: {
        maxPerStream: { enabled: true, value: 3 },
        maxPerUserPerStream: { enabled: false, value: null },
        globalCooldownSeconds: { enabled: false, value: null }
      }
    })
  })

  await t.test('a refusal marks every refused field, keeps what was typed, and reloads nothing', async () => {
    handlers = { 'POST /api/integrations/twitch/rewards': () => refusal(['title', 'limits.maxPerStream.value']) }
    toggle('twitchMaxPerStreamEnabled', true)
    type('twitchRewardCost', '10')

    await saveReward()

    assert.ok(has('twitchRewardTitle', 'error'))
    assert.ok(has('twitchMaxPerStream', 'error'))
    assert.equal(has('twitchRewardCost', 'error'), false)
    assert.equal(field('twitchRewardCost').value, '10')
    assert.deepEqual(requests, ['POST /api/integrations/twitch/rewards'])
    assert.ok(toasts().includes('toast.settingsPartiallySaved'))
  })

  await t.test('a new reward is created, selected and saved as the song-request reward', async () => {
    const created = reward({ id: 'new1', title: 'Fresh' })
    handlers = {
      'POST /api/integrations/twitch/rewards': () => ({ config: created, rejected: [] }),
      'GET /api/integrations/twitch/rewards': () => ({ rewards: [created] }),
      'PUT /api/integrations/twitch/config': () => ({ config: { channelPointsRewardId: 'new1', autoFulfillRedemptions: false, chatCommands: {} }, rejected: [] })
    }
    type('twitchRewardTitle', 'Fresh')
    type('twitchRewardCost', '500')

    await saveReward()

    assert.deepEqual(requests, ['POST /api/integrations/twitch/rewards', 'GET /api/integrations/twitch/rewards', 'PUT /api/integrations/twitch/config'])
    assert.equal(bodies['PUT /api/integrations/twitch/config'].channelPointsRewardId, 'new1')
    assert.equal(state.twitch.selectedRewardId, 'new1')
    assert.equal(state.twitch.editingReward.id, 'new1')
    assert.ok(toasts().includes('toast.twitchRewardCreated'))
    assert.equal(toasts().includes('toast.twitchSettingsSaved'), false, 'one message for the creation, not one more for the song-request setting')
  })

  await t.test('an existing reward is updated by its id, shows what the server stored, and marks only what really changed as saved', async () => {
    const stored = reward({ title: 'Renamed', cost: 500 })
    state.twitch.rewards = [reward()]
    state.twitch.selectedRewardId = 'rw1'
    showRewardForm(reward())
    handlers = {
      'PATCH /api/integrations/twitch/rewards/rw1': () => ({ config: stored, rejected: [] }),
      'GET /api/integrations/twitch/rewards': () => ({ rewards: [stored] })
    }
    type('twitchRewardTitle', 'Renamed')

    await saveReward()

    assert.deepEqual(requests, ['PATCH /api/integrations/twitch/rewards/rw1', 'GET /api/integrations/twitch/rewards'])
    assert.ok(has('twitchRewardTitle', 'saved'))
    assert.equal(has('twitchRewardCost', 'saved'), false)
    assert.equal(state.twitch.editingReward.title, 'Renamed')
    assert.equal(state.twitch.selectedRewardId, 'rw1')
    assert.ok(document.getElementById('twitchRewardSelect').textContent.includes('Renamed (500)'), 'the select shows the new title')
    assert.ok(toasts().includes('toast.twitchRewardUpdated'))
  })
})

test('the background colour', async (t) => {
  t.beforeEach(reset)

  const picker = () => field('twitchRewardBackgroundColorPicker')

  await t.test('typing a colour moves the colour picker, with or without the #', () => {
    type('twitchRewardBackgroundColor', '#ff0000')
    assert.equal(picker().value, '#ff0000')

    type('twitchRewardBackgroundColor', '00ff00')
    assert.equal(picker().value, '#00ff00')
  })

  await t.test('something that is not a colour yet leaves the picker at the default', () => {
    type('twitchRewardBackgroundColor', '#12')

    assert.equal(picker().value, '#000000')
  })

  await t.test('picking a colour types it in capitals, and the text field is marked like any typed one', () => {
    showRewardForm(reward())

    picker().value = '#00ff00'
    picker().dispatchEvent(new jsdom.window.Event('input', { bubbles: true }))

    assert.equal(field('twitchRewardBackgroundColor').value, '#00FF00')
    assert.ok(has('twitchRewardBackgroundColor', 'changed'))
  })

  await t.test('the page lets the field hold a colour with its # (7 characters)', () => {
    assert.equal(field('twitchRewardBackgroundColor').maxLength, 7)
  })
})
