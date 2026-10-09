import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const jsdom = new JSDOM(
  `<!doctype html><html><body>
    <div id="twitchRewardForm"><h2></h2></div>
    <input id="twitchRewardTitle" type="text" maxlength="45" />
    <input id="twitchRewardCost" type="number" />
    <input id="twitchRewardPrompt" type="text" maxlength="140" />
    <input id="twitchRewardBackgroundColorPicker" type="color" />
    <input id="twitchRewardBackgroundColor" type="text" />
    <input id="twitchRewardEnabled" type="checkbox" />
    <input id="twitchMaxPerStreamEnabled" type="checkbox" />
    <input id="twitchMaxPerStream" type="number" disabled />
    <input id="twitchMaxPerUserPerStreamEnabled" type="checkbox" />
    <input id="twitchMaxPerUserPerStream" type="number" disabled />
    <input id="twitchGlobalCooldownEnabled" type="checkbox" />
    <input id="twitchGlobalCooldownSeconds" type="number" disabled />
    <button id="twitchSaveRewardBtn"></button>
    <select id="twitchRewardSelect"></select>
    <input id="twitchAutoFulfillRedemptions" type="checkbox" />
    <div id="toastContainer"></div>
  </body></html>`
)

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
  return { ok: true, json: async () => ({ data: await handler() }) }
}

const { state } = await import('../../../public/js/control/state.js')
const { dom } = await import('../../../public/js/control/dom.js')
const { showRewardForm, markRewardSaved, readRewardForm, bindRewardForm } = await import('../../../public/js/control/twitch/twitch-reward-form.js')
const { saveReward, cancelRewardChanges } = await import('../../../public/js/control/twitch/twitch-rewards.js')

bindRewardForm()

const reward = (over = {}) => ({
  id: 'rw1',
  title: 'Song request',
  cost: 500,
  prompt: 'Paste a link',
  background_color: '#9147FF',
  is_enabled: true,
  max_per_stream_setting: { is_enabled: true, max_per_stream: 5 },
  max_per_user_per_stream_setting: { is_enabled: false, max_per_user_per_stream: 0 },
  global_cooldown_setting: { is_enabled: true, global_cooldown_seconds: 60 },
  ...over
})

const has = (input, name) => input.classList.contains(name)
const type = (input, value) => {
  input.value = value
  input.dispatchEvent(new jsdom.window.Event('input', { bubbles: true }))
}
const toggle = (input, checked) => {
  input.checked = checked
  input.dispatchEvent(new jsdom.window.Event('change', { bubbles: true }))
}

function reset() {
  handlers = {}
  requests = []
  bodies = {}
  state.twitch.rewards = []
  state.twitch.selectedRewardId = ''
  for (const input of document.querySelectorAll('input')) input.classList.remove('changed', 'saved', 'error')
  showRewardForm()
}

test('showRewardForm()', async (t) => {
  t.beforeEach(reset)

  await t.test('blank: an empty enabled reward with every limit off and its number locked', () => {
    assert.equal(state.twitch.editingReward, null)
    assert.equal(dom.twitchRewardTitle.value, '')
    assert.equal(dom.twitchRewardCost.value, '')
    assert.equal(dom.twitchRewardEnabled.checked, true)

    for (const [toggleInput, number] of [
      [dom.twitchMaxPerStreamEnabled, dom.twitchMaxPerStream],
      [dom.twitchMaxPerUserPerStreamEnabled, dom.twitchMaxPerUserPerStream],
      [dom.twitchGlobalCooldownEnabled, dom.twitchGlobalCooldownSeconds]
    ]) {
      assert.equal(toggleInput.checked, false)
      assert.equal(number.disabled, true)
      assert.equal(number.value, '')
    }
  })

  await t.test('with a reward: fills the fields, unlocks the limits that are on and leaves the others empty', () => {
    showRewardForm(reward())

    assert.equal(dom.twitchRewardTitle.value, 'Song request')
    assert.equal(dom.twitchRewardCost.value, '500')
    assert.equal(dom.twitchRewardPrompt.value, 'Paste a link')
    assert.equal(dom.twitchRewardBackgroundColor.value, '#9147FF')
    assert.equal(dom.twitchMaxPerStreamEnabled.checked, true)
    assert.equal(dom.twitchMaxPerStream.disabled, false)
    assert.equal(dom.twitchMaxPerStream.value, '5')
    assert.equal(dom.twitchMaxPerUserPerStreamEnabled.checked, false)
    assert.equal(dom.twitchMaxPerUserPerStream.disabled, true)
    assert.equal(dom.twitchMaxPerUserPerStream.value, '')
    assert.equal(dom.twitchGlobalCooldownSeconds.value, '60')
  })

  await t.test('the heading says whether a reward is edited or created, and the editing copy is detached from the list', () => {
    const heading = () => document.querySelector('#twitchRewardForm h2').textContent
    const original = reward()

    showRewardForm(original)
    const editing = heading()
    original.title = 'changed in the list afterwards'
    assert.equal(state.twitch.editingReward.title, 'Song request')

    showRewardForm()
    assert.notEqual(heading(), editing)
  })

  await t.test('clears every changed, saved and error mark', () => {
    // the auto-fulfil checkbox belongs to the Twitch settings, not to the reward form, and keeps its own marks
    const formInputs = [...document.querySelectorAll('#twitchRewardForm ~ input')].filter((input) => input.id !== 'twitchAutoFulfillRedemptions')
    for (const input of formInputs) input.classList.add('error', 'saved')

    showRewardForm(reward())

    assert.equal(formInputs.filter((input) => has(input, 'error') || has(input, 'saved') || has(input, 'changed')).length, 0)
  })
})

test('readRewardForm()', async (t) => {
  t.beforeEach(reset)

  const fillValid = () => {
    dom.twitchRewardTitle.value = '  Song request  '
    dom.twitchRewardCost.value = '300'
    dom.twitchRewardPrompt.value = ''
  }

  await t.test('a valid new reward: trimmed title, numbers, no empty prompt, limits that are off sent as off', () => {
    fillValid()

    const data = readRewardForm()

    assert.equal(data.title, 'Song request')
    assert.equal(data.cost, 300)
    assert.equal(data.prompt, undefined)
    assert.equal(data.is_enabled, true)
    assert.equal(data.is_max_per_stream_enabled, false)
    assert.equal(data.max_per_stream, undefined)
    assert.equal(document.querySelectorAll('input.error').length, 0)
  })

  await t.test('an existing reward sends an empty prompt, because that is how a prompt is cleared', () => {
    showRewardForm(reward())
    dom.twitchRewardPrompt.value = ''

    assert.equal(readRewardForm().prompt, '')
  })

  await t.test('a limit that is on is sent with its number', () => {
    fillValid()
    dom.twitchMaxPerStreamEnabled.checked = true
    dom.twitchMaxPerStream.value = '7'

    const data = readRewardForm()

    assert.equal(data.is_max_per_stream_enabled, true)
    assert.equal(data.max_per_stream, 7)
  })

  await t.test('nothing is returned for a bad form, and every bad input is marked at once', () => {
    dom.twitchRewardTitle.value = ''
    dom.twitchRewardCost.value = '2.5'
    dom.twitchRewardPrompt.value = 'x'.repeat(141)
    dom.twitchMaxPerStreamEnabled.checked = true
    dom.twitchMaxPerStream.value = '0'

    assert.equal(readRewardForm(), null)
    for (const input of [dom.twitchRewardTitle, dom.twitchRewardCost, dom.twitchRewardPrompt, dom.twitchMaxPerStream]) {
      assert.ok(has(input, 'error'), input.id)
    }
  })

  await t.test('the title limit is 45 characters and the cost must be a whole number from 1', () => {
    fillValid()
    dom.twitchRewardTitle.value = 'x'.repeat(45)
    assert.ok(readRewardForm())
    dom.twitchRewardTitle.value = 'x'.repeat(46)
    assert.equal(readRewardForm(), null)
    dom.twitchRewardTitle.value = 'ok'

    for (const cost of ['', '0', '-5', '1.5']) {
      dom.twitchRewardCost.value = cost
      assert.equal(readRewardForm(), null, `cost "${cost}"`)
    }
    dom.twitchRewardCost.value = '1'
    assert.ok(readRewardForm())
  })

  await t.test('a number in a limit that is off is not checked', () => {
    fillValid()
    dom.twitchMaxPerStream.value = 'garbage'

    assert.ok(readRewardForm())
  })

  await t.test('an error mark goes away as soon as the input is touched', () => {
    dom.twitchRewardTitle.value = ''
    readRewardForm()
    assert.ok(has(dom.twitchRewardTitle, 'error'))

    type(dom.twitchRewardTitle, 'now fine')

    assert.equal(has(dom.twitchRewardTitle, 'error'), false)
  })
})

test('the limit toggles', async (t) => {
  t.beforeEach(reset)

  await t.test('turning a limit on unlocks its number, turning it off locks and empties it', () => {
    toggle(dom.twitchMaxPerStreamEnabled, true)
    assert.equal(dom.twitchMaxPerStream.disabled, false)

    dom.twitchMaxPerStream.value = '9'
    toggle(dom.twitchMaxPerStreamEnabled, false)
    assert.equal(dom.twitchMaxPerStream.disabled, true)
    assert.equal(dom.twitchMaxPerStream.value, '')
  })
})

test('changed marks', async (t) => {
  t.beforeEach(reset)

  await t.test('an input of an edited reward is marked while it differs from what Twitch has, and cleared when it matches again', () => {
    showRewardForm(reward())

    type(dom.twitchRewardTitle, 'Another title')
    assert.ok(has(dom.twitchRewardTitle, 'changed'))
    assert.equal(has(dom.twitchRewardCost, 'changed'), false)

    type(dom.twitchRewardTitle, 'Song request')
    assert.equal(has(dom.twitchRewardTitle, 'changed'), false)
  })

  await t.test('checkboxes are marked too', () => {
    showRewardForm(reward())

    toggle(dom.twitchRewardEnabled, false)
    assert.ok(has(dom.twitchRewardEnabled, 'changed'))
    toggle(dom.twitchRewardEnabled, true)
    assert.equal(has(dom.twitchRewardEnabled, 'changed'), false)
  })

  await t.test('a new reward has nothing to differ from: no marks', () => {
    type(dom.twitchRewardTitle, 'Brand new')
    assert.equal(has(dom.twitchRewardTitle, 'changed'), false)
  })
})

test('markRewardSaved()', async (t) => {
  t.beforeEach(reset)

  await t.test('marks only what the save really changed, and remembers the saved reward', () => {
    const before = reward()
    const after = reward({ title: 'New title', cost: 800 })

    showRewardForm(after) // the form is redrawn with what Twitch answered
    markRewardSaved(after, before)

    assert.ok(has(dom.twitchRewardTitle, 'saved'))
    assert.ok(has(dom.twitchRewardCost, 'saved'))
    assert.equal(has(dom.twitchRewardPrompt, 'saved'), false)
    assert.equal(has(dom.twitchRewardEnabled, 'saved'), false)
    assert.equal(state.twitch.editingReward.title, 'New title')
  })

  await t.test('a limit that was turned off shows its toggle and its emptied number as saved', () => {
    const before = reward()
    const after = reward({ max_per_stream_setting: { is_enabled: false, max_per_stream: 0 } })

    showRewardForm(after)
    markRewardSaved(after, before)

    assert.ok(has(dom.twitchMaxPerStreamEnabled, 'saved'))
    assert.ok(has(dom.twitchMaxPerStream, 'saved'))
    assert.equal(has(dom.twitchGlobalCooldownEnabled, 'saved'), false)
  })

  await t.test('without a previous reward nothing is marked', () => {
    showRewardForm(reward())
    markRewardSaved(reward(), null)

    assert.equal(document.querySelectorAll('input.saved').length, 0)
  })
})

test('cancelRewardChanges()', async (t) => {
  t.beforeEach(reset)

  await t.test('puts the stored reward back and clears the marks', () => {
    showRewardForm(reward())
    type(dom.twitchRewardTitle, 'typed')
    toggle(dom.twitchRewardEnabled, false)

    cancelRewardChanges()

    assert.equal(dom.twitchRewardTitle.value, 'Song request')
    assert.equal(dom.twitchRewardEnabled.checked, true)
    assert.equal(document.querySelectorAll('input.changed').length, 0)
  })

  await t.test('while a new reward is being made it empties the form', () => {
    type(dom.twitchRewardTitle, 'half written')

    cancelRewardChanges()

    assert.equal(dom.twitchRewardTitle.value, '')
  })
})

test('saveReward()', async (t) => {
  t.beforeEach(reset)

  await t.test('a new reward is created, selected and saved as the song-request reward', async () => {
    const created = reward({ id: 'new1', title: 'Fresh', cost: 100 })
    handlers['POST /api/integrations/twitch/rewards'] = () => ({ reward: created })
    handlers['GET /api/integrations/twitch/rewards'] = () => ({ rewards: [created] })
    handlers['PUT /api/integrations/twitch/config'] = () => ({
      config: { channelPointsRewardId: 'new1', autoFulfillRedemptions: false },
      rejected: []
    })
    dom.twitchRewardTitle.value = 'Fresh'
    dom.twitchRewardCost.value = '100'

    await saveReward()

    assert.equal(bodies['POST /api/integrations/twitch/rewards'].title, 'Fresh')
    assert.equal(
      requests.some((r) => r.startsWith('PATCH')),
      false,
      'a new reward is not an edit'
    )
    assert.equal(bodies['PUT /api/integrations/twitch/config'].channelPointsRewardId, 'new1')
    assert.equal(state.twitch.selectedRewardId, 'new1')
  })

  await t.test('an existing reward is updated by its id and keeps its place as the selected one', async () => {
    const before = reward()
    const after = reward({ title: 'Renamed' })
    state.twitch.selectedRewardId = 'rw1'
    handlers['PATCH /api/integrations/twitch/rewards/rw1'] = () => ({ reward: after })
    handlers['GET /api/integrations/twitch/rewards'] = () => ({ rewards: [after] })
    showRewardForm(before)
    dom.twitchRewardTitle.value = 'Renamed'

    await saveReward()

    assert.equal(bodies['PATCH /api/integrations/twitch/rewards/rw1'].title, 'Renamed')
    assert.equal(
      requests.some((r) => r.startsWith('POST')),
      false,
      'an edit does not create a second reward'
    )
    assert.equal(
      requests.some((r) => r.startsWith('PUT')),
      false,
      'the selected reward does not change'
    )
    assert.ok(has(dom.twitchRewardTitle, 'saved'))
    assert.equal(has(dom.twitchRewardCost, 'saved'), false)
  })

  await t.test('a form with a mistake sends nothing', async () => {
    dom.twitchRewardTitle.value = ''

    await saveReward()

    assert.deepEqual(requests, [])
    assert.ok(has(dom.twitchRewardTitle, 'error'))
  })
})

test('the background colour', async (t) => {
  t.beforeEach(reset)

  const valid = () => {
    dom.twitchRewardTitle.value = 'Song request'
    dom.twitchRewardCost.value = '300'
  }

  await t.test('a typed colour is accepted with or without the #, in any case, and sent as #RRGGBB', () => {
    valid()

    for (const typed of ['00ff00', '#00ff00', '00FF00', ' #00Ff00 ']) {
      dom.twitchRewardBackgroundColor.value = typed
      assert.equal(readRewardForm()?.background_color, '#00FF00', `typed "${typed}"`)
      assert.equal(has(dom.twitchRewardBackgroundColor, 'error'), false)
    }
  })

  await t.test('something that is not a six-digit colour is refused and marked', () => {
    valid()

    for (const typed of ['GGGGGG', '12345', '#12345', '1234567', '#', 'red']) {
      dom.twitchRewardBackgroundColor.value = typed
      assert.equal(readRewardForm(), null, `typed "${typed}"`)
      assert.ok(has(dom.twitchRewardBackgroundColor, 'error'), `typed "${typed}"`)
    }
  })

  await t.test('an empty colour is simply not sent', () => {
    valid()
    dom.twitchRewardBackgroundColor.value = ''

    assert.equal(readRewardForm().background_color, undefined)
  })

  await t.test('typing a colour moves the colour picker, and picking one fills the text field', () => {
    type(dom.twitchRewardBackgroundColor, 'ff0000')
    assert.equal(dom.twitchRewardBackgroundColorPicker.value, '#ff0000')

    dom.twitchRewardBackgroundColorPicker.value = '#0000ff'
    dom.twitchRewardBackgroundColorPicker.dispatchEvent(new jsdom.window.Event('input', { bubbles: true }))
    assert.equal(dom.twitchRewardBackgroundColor.value, '#0000FF')
  })

  await t.test('the page lets the field hold a colour with its # (7 characters)', () => {
    const html = readFileSync(fileURLToPath(new URL('../../../public/index.html', import.meta.url)), 'utf8')
    const field = /<input[^>]*id="twitchRewardBackgroundColor"[^>]*>/.exec(html)?.[0] ?? ''

    assert.ok(Number(/maxlength="(\d+)"/.exec(field)?.[1]) >= 7, field)
  })
})
