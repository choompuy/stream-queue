import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setupPanel } from './panel-env.js'

const panel = setupPanel()

const { initI18n } = await import('../../../public/js/i18n.js')
await initI18n('en')
const { reportSaveResult, trackChanges } = await import('../../../public/js/control/save-result.js')

const field = () => document.createElement('input')
const stateOf = (input) => ['changed', 'saved', 'error'].filter((name) => input.classList.contains(name))

test('reportSaveResult', async (t) => {
  await t.test('colours each field by what happened to it: refused red, stored with a new value green, unchanged nothing', () => {
    const [refused, saved, unchanged] = [field(), field(), field()]
    saved.classList.add('changed')

    reportSaveResult(
      [
        { input: refused, path: 'maxQueueSize', changed: true },
        { input: saved, path: 'minViews', changed: true },
        { input: unchanged, path: 'regionCode', changed: false }
      ],
      ['maxQueueSize'],
      'toast.settingsSaved'
    )

    assert.deepEqual(stateOf(refused), ['error'])
    assert.deepEqual(stateOf(saved), ['saved'])
    assert.deepEqual(stateOf(unchanged), [])
  })

  await t.test('says so in one green toast when nothing was refused', () => {
    reportSaveResult([{ input: field(), path: 'minViews', changed: true }], [], 'toast.twitchSettingsSaved')

    assert.ok(panel.toasts().includes('Twitch settings saved'))
  })

  await t.test('counts what was stored and what was refused when something was refused', () => {
    reportSaveResult(
      [
        { input: field(), path: 'a', changed: true },
        { input: field(), path: 'b', changed: true },
        { input: field(), path: 'c', changed: true }
      ],
      ['c'],
      'toast.settingsSaved'
    )

    assert.ok(panel.toasts().includes('Saved 2, not saved 1 (invalid values)'))
  })

  await t.test('a refused field is reported even when the caller does not want the green toast', () => {
    const before = panel.toasts().length
    reportSaveResult([{ input: field(), path: 'a', changed: true }], [], 'toast.settingsSaved', { successToast: false })
    assert.equal(panel.toasts().length, before, 'no success toast was asked for')

    reportSaveResult([{ input: field(), path: 'a', changed: true }], ['a'], 'toast.settingsSaved', { successToast: false })
    assert.ok(panel.toasts().includes('Saved 0, not saved 1 (invalid values)'))
  })
})

test('trackChanges', async (t) => {
  await t.test('marks the input while it differs from the stored value, and clears the mark when it matches again', () => {
    const input = field()
    let differs = false
    trackChanges(input, () => differs)

    differs = true
    input.dispatchEvent(new window.Event('input'))
    assert.deepEqual(stateOf(input), ['changed'])

    differs = false
    input.dispatchEvent(new window.Event('change'))
    assert.deepEqual(stateOf(input), [])

    differs = true
    input.dispatchEvent(new window.Event('focus'))
    assert.deepEqual(stateOf(input), ['changed'])
  })

  await t.test('an input that is not on the page is ignored', () => {
    assert.doesNotThrow(() => trackChanges(null, () => true))
  })
})
