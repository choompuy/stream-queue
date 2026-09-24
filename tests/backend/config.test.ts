import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// config.json is read from process.cwd()/data at import time: keep the test away from the real one
process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const { getConfig, updateConfig, validateConfigUpdates } = await import('../../src/config.js')

const DEFAULTS = getConfig()

beforeEach(() => {
  updateConfig({ ...DEFAULTS, fallbackPlaylist: { ...DEFAULTS.fallbackPlaylist } })
})

test('validateConfigUpdates()', async (t) => {
  await t.test('accepts every field the config has (a new field without a rule would be refused)', () => {
    assert.deepEqual(validateConfigUpdates(getConfig()).rejected, [])
  })

  await t.test('reports invalid top-level values by name and keeps the valid ones', () => {
    const { clean, rejected } = validateConfigUpdates({ maxQueueSize: -5, minViews: 100, regionCode: 'RUS' })

    assert.deepEqual(rejected.sort(), ['maxQueueSize', 'regionCode'])
    assert.deepEqual(clean, { minViews: 100 })
  })

  for (const value of ['x', 5, null, [], true]) {
    await t.test(`refuses fallbackPlaylist = ${JSON.stringify(value)} instead of throwing`, () => {
      const { clean, rejected } = validateConfigUpdates({ fallbackPlaylist: value })

      assert.deepEqual(rejected, ['fallbackPlaylist'])
      assert.equal('fallbackPlaylist' in clean, false)
    })
  }

  await t.test('reports invalid nested fields with a dotted name', () => {
    const { clean, rejected } = validateConfigUpdates({ fallbackPlaylist: { repeat: 'yes', enabled: 1, shuffle: true, playlistId: 42 } })

    assert.deepEqual(rejected.sort(), ['fallbackPlaylist.enabled', 'fallbackPlaylist.playlistId', 'fallbackPlaylist.repeat'])
    assert.deepEqual(clean.fallbackPlaylist, { shuffle: true })
  })

  await t.test('refuses unknown fields, including prototype keys', () => {
    const { clean, rejected } = validateConfigUpdates(JSON.parse('{"foo":1,"__proto__":{"polluted":true},"constructor":1,"minViews":5}'))

    assert.deepEqual(rejected.sort(), ['__proto__', 'constructor', 'foo'])
    assert.deepEqual(clean, { minViews: 5 })
    assert.equal(({} as Record<string, unknown>).polluted, undefined)
  })

  await t.test('refuses a body that is not an object', () => {
    for (const body of [null, 'x', 5, [1, 2]]) assert.deepEqual(validateConfigUpdates(body).rejected, ['body'])
  })

  await t.test('rejects a duration range where min >= max, so filtering could never let a video through', () => {
    const { clean, rejected } = validateConfigUpdates({ minDurationSeconds: 500, maxDurationSeconds: 60 })

    assert.deepEqual(rejected.sort(), ['maxDurationSeconds', 'minDurationSeconds'])
    assert.equal('minDurationSeconds' in clean, false)
    assert.equal('maxDurationSeconds' in clean, false)
  })

  await t.test('min == max is also rejected (an empty range, nothing could ever fit)', () => {
    const { rejected } = validateConfigUpdates({ minDurationSeconds: 180, maxDurationSeconds: 180 })
    assert.deepEqual(rejected.sort(), ['maxDurationSeconds', 'minDurationSeconds'])
  })

  await t.test('checks a single changed bound against the one already on file, not just against itself', () => {
    const current = { ...DEFAULTS, minDurationSeconds: 60, maxDurationSeconds: 480 }

    // only sending minDurationSeconds, but it would land above the stored maxDurationSeconds
    const { clean, rejected } = validateConfigUpdates({ minDurationSeconds: 500 }, current)

    assert.deepEqual(rejected, ['minDurationSeconds'])
    assert.equal('minDurationSeconds' in clean, false)
  })

  await t.test('a valid range update leaves other invalid fields in the same request rejected independently', () => {
    const { clean, rejected } = validateConfigUpdates({ minDurationSeconds: 60, maxDurationSeconds: 480, maxQueueSize: -5 })

    assert.deepEqual(rejected, ['maxQueueSize'])
    assert.deepEqual(clean, { minDurationSeconds: 60, maxDurationSeconds: 480 })
  })

  await t.test('a range that is already valid, with neither bound in this update, is not rejected', () => {
    const current = { ...DEFAULTS, minDurationSeconds: 60, maxDurationSeconds: 480 }
    const { clean, rejected } = validateConfigUpdates({ minViews: 5000 }, current)

    assert.deepEqual(rejected, [])
    assert.deepEqual(clean, { minViews: 5000 })
  })
})

test('updateConfig()', async (t) => {
  await t.test('applies valid fields and merges a partial fallbackPlaylist into the existing one', () => {
    updateConfig({ fallbackPlaylist: { playlistId: 'PLconfigtest01', repeat: true } })
    const { config } = updateConfig({ fallbackPlaylist: { shuffle: true } })

    assert.deepEqual(config.fallbackPlaylist, { playlistId: 'PLconfigtest01', enabled: true, shuffle: true, repeat: true })
  })

  await t.test('does not store unknown fields', () => {
    updateConfig(JSON.parse('{"foo":1,"minViews":7}'))

    assert.equal(getConfig().minViews, 7)
    assert.equal('foo' in getConfig(), false)
  })

  await t.test('does not throw on a malformed fallbackPlaylist and leaves it unchanged', () => {
    const before = getConfig().fallbackPlaylist
    const { rejected } = updateConfig({ fallbackPlaylist: 'x' as never })

    assert.deepEqual(rejected, ['fallbackPlaylist'])
    assert.deepEqual(getConfig().fallbackPlaylist, before)
  })

  await t.test('returns copies: mutating a result does not change the stored config', () => {
    const { config } = updateConfig({})
    config.fallbackPlaylist.repeat = true
    getConfig().fallbackPlaylist.shuffle = true

    assert.equal(getConfig().fallbackPlaylist.repeat, false)
    assert.equal(getConfig().fallbackPlaylist.shuffle, false)
  })
})
