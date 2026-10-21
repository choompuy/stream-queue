import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// settings.json is written to process.cwd()/data: keep the test away from the real one
process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const { getSettings, updateSettings, validateSettingsUpdates } = await import('../../src/settings.js')
const { on } = await import('../../src/state-events.js')
const { flushAllStores } = await import('../../src/persist.js')

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
    updateSettings({ showVideo: false, hideOverlayInfo: false, opacity: 100, position: 'bottom-right', locale: 'en' })
    const { config, rejected } = updateSettings({ position: 'top-right', showVideo: 'yes' as never, locale: 'xx' as never })

    assert.deepEqual(config, { showVideo: false, hideOverlayInfo: false, opacity: 100, position: 'top-right', locale: 'en' })
    assert.deepEqual(rejected.sort(), ['locale', 'showVideo'])
    assert.deepEqual(getSettings(), config)
  })
})

test('an update that changes nothing', async (t) => {
  await t.test('rewrites no file and wakes no tab', async () => {
    updateSettings({ opacity: 42 })
    await flushAllStores()
    const file = join(process.cwd(), 'data', 'settings.json')
    assert.ok(existsSync(file))
    rmSync(file)

    const events: string[] = []
    const stop = on('state', () => events.push('state'))

    try {
      assert.equal(updateSettings({ opacity: 42 }).changed, false, 'the same value')
      assert.equal(updateSettings({}).changed, false, 'an empty update')
      assert.equal(updateSettings({ opacity: 'nope' as never }).changed, false, 'a fully rejected update')
      await flushAllStores()

      assert.equal(existsSync(file), false, 'settings.json was not rewritten')
      assert.deepEqual(events, [], 'no state event was emitted')
    } finally {
      stop()
    }
  })

  await t.test('a real change still saves and emits', async () => {
    const events: string[] = []
    const stop = on('state', () => events.push('state'))

    try {
      assert.equal(updateSettings({ opacity: 43 }).changed, true)
      await flushAllStores()

      assert.deepEqual(events, ['state'])
      assert.ok(existsSync(join(process.cwd(), 'data', 'settings.json')))
    } finally {
      stop()
    }
  })
})
