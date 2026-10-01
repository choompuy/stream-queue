import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getSettings, updateSettings, validateSettingsUpdates, resetSettings } from '../../src/settings.js'

test('validateSettingsUpdates()', async (t) => {
  await t.test('accepts every valid field', () => {
    const { clean, rejected } = validateSettingsUpdates({ showVideo: true, position: 'top-left', locale: 'ru' })

    assert.deepEqual(rejected, [])
    assert.deepEqual(clean, { showVideo: true, position: 'top-left', locale: 'ru' })
  })

  await t.test('names invalid values and unknown fields, keeps the valid ones', () => {
    const { clean, rejected } = validateSettingsUpdates({ showVideo: 'abc', position: 'nowhere', locale: 'xx', extra: 1, showVideo2: true })

    assert.deepEqual(rejected.sort(), ['extra', 'locale', 'position', 'showVideo', 'showVideo2'])
    assert.deepEqual(clean, {})
  })

  await t.test('refuses prototype keys', () => {
    const { rejected } = validateSettingsUpdates(JSON.parse('{"__proto__":{"x":1},"constructor":1}'))
    assert.deepEqual(rejected.sort(), ['__proto__', 'constructor'])
  })

  await t.test('refuses a body that is not an object', () => {
    for (const body of [null, 'x', 5, [1]]) assert.deepEqual(validateSettingsUpdates(body).rejected, ['body'])
  })
})

test('updateSettings()', async (t) => {
  await t.test('applies the valid part only', () => {
    resetSettings()
    const result = updateSettings({ position: 'top-right', showVideo: 'yes' as never, locale: 'xx' as never })

    assert.deepEqual(result, { showVideo: false, position: 'top-right', locale: 'en' })
    assert.deepEqual(getSettings(), result)
  })
})
