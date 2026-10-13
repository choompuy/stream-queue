import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setupPanel } from './panel-env.js'

const panel = setupPanel()

const { initI18n } = await import('../../../public/js/i18n.js')
await initI18n('en')
const { readForm, fillForm, isChanged, markChanged, trackForm, saveForm, toastSaveResult } = await import('../../../public/js/control/form.js')

document.body.insertAdjacentHTML(
  'beforeend',
  `<div id="demo">
    <input id="views" name="minViews" type="number" />
    <input id="region" name="region.code" type="text" />
    <input id="shorts" name="allowShorts" type="checkbox" />
    <select id="mode" name="contentMode"><option value="music">music</option><option value="any">any</option></select>
    <input id="skipCommand" name="chatCommands.skip.command" type="text" />
    <input id="loose" type="text" />
  </div>
  <div id="demo2">
    <input id="limitOn" name="limit.enabled" type="checkbox" data-enables="limitValue" />
    <input id="limitValue" name="limit.value" type="number" />
    <select id="empty" name="pick"></select>
  </div>`
)

const form = document.getElementById('demo')
const form2 = document.getElementById('demo2')
const input = (id) => document.getElementById(id)
const marks = (id) => ['changed', 'saved', 'error'].filter((name) => input(id).classList.contains(name))
const fire = (id, type) => input(id).dispatchEvent(new window.Event(type, { bubbles: true }))

test('readForm', async (t) => {
  await t.test('builds the body from the names: nested by their dots, typed by the kind of input, text trimmed', () => {
    input('views').value = '25'
    input('region').value = '  US '
    input('shorts').checked = true
    input('mode').value = 'any'
    input('skipCommand').value = ' !sg skip '

    assert.deepEqual(readForm(form), {
      minViews: 25,
      region: { code: 'US' },
      allowShorts: true,
      contentMode: 'any',
      chatCommands: { skip: { command: '!sg skip' } }
    })
  })

  await t.test('an empty number is null, not zero: the server refuses it instead of silently storing 0', () => {
    input('views').value = ''

    assert.equal(readForm(form).minViews, null)
  })

  await t.test('an input without a name is not part of the form', () => {
    input('loose').value = 'typed'

    assert.equal(JSON.stringify(readForm(form)).includes('typed'), false)
  })
})

test('fillForm', async (t) => {
  const stored = { minViews: 10, region: { code: 'DE' }, allowShorts: true, contentMode: 'any', chatCommands: { skip: { command: '!sg skip' } } }

  await t.test('puts the stored values into the inputs by name, whatever the kind of input', () => {
    fillForm(form, stored)

    assert.equal(input('views').value, '10')
    assert.equal(input('region').value, 'DE')
    assert.equal(input('shorts').checked, true)
    assert.equal(input('mode').value, 'any')
    assert.equal(input('skipCommand').value, '!sg skip')
  })

  await t.test('what was put in is what "changed" is measured against, for every kind of input', () => {
    assert.deepEqual(['views', 'region', 'shorts', 'mode', 'skipCommand'].filter((id) => isChanged(input(id))), [])

    input('views').value = '11'
    input('region').value = 'FR '
    input('shorts').checked = false
    input('mode').value = 'music'
    input('skipCommand').value = '!other'
    assert.deepEqual(['views', 'region', 'shorts', 'mode', 'skipCommand'].filter((id) => !isChanged(input(id))), [])

    input('region').value = ' DE '
    assert.equal(isChanged(input('region')), false, 'surrounding spaces are not a change: they are trimmed on save')
  })

  await t.test('clears the marks, leaves a name the server refused as typed, and ignores a value the object does not have', () => {
    input('views').classList.add('changed')
    input('region').classList.add('error')
    input('region').value = 'typed'
    input('skipCommand').value = 'keep me'

    fillForm(form, { minViews: 10, chatCommands: {} }, { skip: ['region.code'] })

    assert.deepEqual(marks('views'), [])
    assert.deepEqual(marks('region'), ['error'])
    assert.equal(input('region').value, 'typed')
    assert.equal(input('skipCommand').value, 'keep me', 'no stored value: left alone')
  })
})

test('trackForm', async (t) => {
  fillForm(form, { minViews: 10, region: { code: 'DE' }, allowShorts: false, contentMode: 'music', chatCommands: { skip: { command: '!sg skip' } } })
  trackForm(form)

  await t.test('marks an input yellow while it differs, and plain again when it matches, on input and on change', () => {
    input('views').value = '11'
    fire('views', 'input')
    assert.deepEqual(marks('views'), ['changed'])

    input('views').value = '10'
    fire('views', 'change')
    assert.deepEqual(marks('views'), [])
  })

  await t.test('typing clears the red mark of a refused input, and focus clears a green one', () => {
    input('region').classList.add('error')
    input('region').value = 'FR'
    fire('region', 'input')
    assert.deepEqual(marks('region'), ['changed'])

    input('region').value = 'DE'
    input('region').classList.add('saved')
    fire('region', 'focusin')
    assert.deepEqual(marks('region'), [])
  })

  await t.test('does not touch an input that has no name', () => {
    input('loose').value = 'typed'
    fire('loose', 'input')

    assert.deepEqual(marks('loose'), [])
  })
})

test('a checkbox that switches another input (data-enables)', async (t) => {
  await t.test('locks the input when the form is filled with the switch off, and unlocks it with the switch on', () => {
    fillForm(form2, { limit: { enabled: false, value: null } })
    assert.equal(input('limitValue').disabled, true)

    fillForm(form2, { limit: { enabled: true, value: 5 } })
    assert.equal(input('limitValue').disabled, false)
    assert.equal(input('limitValue').value, '5')
  })

  await t.test('turning the switch off locks the input and empties it, and the emptied input is marked as changed', () => {
    fillForm(form2, { limit: { enabled: true, value: 5 } })
    trackForm(form2)

    input('limitOn').checked = false
    fire('limitOn', 'change')

    assert.equal(input('limitValue').disabled, true)
    assert.equal(input('limitValue').value, '')
    assert.deepEqual(marks('limitValue'), ['changed'])
    assert.deepEqual(marks('limitOn'), ['changed'])
  })

  await t.test('turning it on again unlocks the input', () => {
    input('limitOn').checked = true
    fire('limitOn', 'change')

    assert.equal(input('limitValue').disabled, false)
  })
})

test('a select', async (t) => {
  await t.test('with no options is not an error, and a stored null selects nothing', () => {
    assert.equal(isChanged(input('empty')), false)

    fillForm(form2, { pick: null })
    assert.equal(input('empty').value, '')
  })

  await t.test('markChanged marks one input by what it was filled with', () => {
    fillForm(form, { minViews: 10 })
    input('views').value = '12'
    markChanged(input('views'))
    assert.deepEqual(marks('views'), ['changed'])
  })
})

test('saveForm', async (t) => {
  const base = { minViews: 10, region: { code: 'DE' }, allowShorts: false, contentMode: 'music', chatCommands: { skip: { command: '!sg skip' } } }

  await t.test('sends the body, shows what the server stored, and marks stored fields green, refused ones red, the rest plain', async () => {
    fillForm(form, base)
    input('views').value = '25'
    input('region').value = 'zz'
    input('skipCommand').value = '  !SG  Skip '
    let sent = null

    const result = await saveForm(form, async (body) => {
      sent = body
      // the server keeps the views, refuses the region, and normalises the command
      return { config: { ...base, minViews: 25, chatCommands: { skip: { command: '!sg skip2' } } }, rejected: ['region.code'] }
    })

    assert.equal(sent.minViews, 25)
    assert.equal(input('skipCommand').value, '!sg skip2')
    assert.equal(input('region').value, 'zz', 'a refused field keeps what was typed')
    assert.deepEqual(marks('views'), ['saved'])
    assert.deepEqual(marks('region'), ['error'])
    assert.deepEqual(marks('skipCommand'), ['saved'])
    assert.deepEqual(marks('shorts'), [])
    assert.deepEqual([result.saved, result.refused], [2, 1])
    assert.deepEqual(result.rejected, ['region.code'])
  })

  await t.test('what was stored is what a later change is measured against', async () => {
    assert.equal(isChanged(input('views')), false)

    input('views').value = '26'
    assert.equal(isChanged(input('views')), true)
  })

  await t.test('a failed request leaves the form as it was', async () => {
    fillForm(form, base)
    input('views').value = '99'

    await assert.rejects(
      saveForm(form, async () => {
        throw new Error('network')
      }),
      /network/
    )

    assert.equal(input('views').value, '99')
    assert.deepEqual(marks('views'), [])
  })
})

test('toastSaveResult', async (t) => {
  await t.test('says it in one green toast when nothing was refused', () => {
    toastSaveResult({ saved: 2, refused: 0 }, 'toast.settingsSaved')

    assert.ok(panel.toasts().includes('Settings saved'))
  })

  await t.test('counts what was stored and what was refused, when something was refused', () => {
    toastSaveResult({ saved: 2, refused: 1 }, 'toast.settingsSaved')

    assert.ok(panel.toasts().includes('Saved 2, not saved 1 (invalid values)'))
  })

  await t.test('the green toast can be left to the caller, the count of refused fields never can', () => {
    toastSaveResult({ saved: 7, refused: 0 }, 'toast.settingsSaved', { successToast: false })
    assert.equal(panel.toasts().some((text) => text.includes('Saved 7')), false, 'no toast at all: nothing was refused and the caller shows its own')

    toastSaveResult({ saved: 0, refused: 1 }, 'toast.settingsSaved', { successToast: false })
    assert.ok(panel.toasts().includes('Saved 0, not saved 1 (invalid values)'))
  })
})
