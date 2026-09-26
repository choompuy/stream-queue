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
  updateConfig({
    ...DEFAULTS,
    fallbackPlaylist: { ...DEFAULTS.fallbackPlaylist },
    twitch: {
      ...DEFAULTS.twitch,
      chatCommands: {
        ...DEFAULTS.twitch.chatCommands,
        now: { ...DEFAULTS.twitch.chatCommands.now },
        next: { ...DEFAULTS.twitch.chatCommands.next },
        skip: { ...DEFAULTS.twitch.chatCommands.skip },
        pause: { ...DEFAULTS.twitch.chatCommands.pause },
        resume: { ...DEFAULTS.twitch.chatCommands.resume },
        stop: { ...DEFAULTS.twitch.chatCommands.stop }
      }
    }
  })
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

  await t.test('treats an empty channelPointsRewardId the same as null - "no reward selected" is valid, not invalid', () => {
    const { clean, rejected } = validateConfigUpdates({ twitch: { channelPointsRewardId: '' } })

    assert.deepEqual(rejected, [])
    assert.deepEqual(clean.twitch, { channelPointsRewardId: null })
  })

  await t.test('trims whitespace-only channelPointsRewardId down to null too', () => {
    const { clean, rejected } = validateConfigUpdates({ twitch: { channelPointsRewardId: '   ' } })

    assert.deepEqual(rejected, [])
    assert.deepEqual(clean.twitch, { channelPointsRewardId: null })
  })

  await t.test('accepts a real reward id and reports it with a dotted name when invalid', () => {
    const accepted = validateConfigUpdates({ twitch: { channelPointsRewardId: 'reward-123' } })
    assert.deepEqual(accepted.rejected, [])
    assert.deepEqual(accepted.clean.twitch, { channelPointsRewardId: 'reward-123' })

    const rejected = validateConfigUpdates({ twitch: { channelPointsRewardId: 42 } })
    assert.deepEqual(rejected.rejected, ['twitch.channelPointsRewardId'])
  })

  await t.test('accepts a valid chat command update and normalizes it (trim, lowercase, collapse whitespace)', () => {
    const { clean, rejected } = validateConfigUpdates({ twitch: { chatCommands: { skip: { command: '  !SG   Skip  ' } } } })

    assert.deepEqual(rejected, [])
    assert.deepEqual(clean.twitch?.chatCommands?.skip, { command: '!sg skip' })
  })

  await t.test('rejects a chat command missing the leading "!"', () => {
    const { rejected } = validateConfigUpdates({ twitch: { chatCommands: { now: { command: 'sg now' } } } })
    assert.deepEqual(rejected, ['twitch.chatCommands.now.command'])
  })

  await t.test('rejects a chat command permission outside the known set', () => {
    const { rejected } = validateConfigUpdates({ twitch: { chatCommands: { skip: { permission: 'vip' } } } })
    assert.deepEqual(rejected, ['twitch.chatCommands.skip.permission'])
  })

  await t.test('rejects an unknown command key under chatCommands', () => {
    const { rejected } = validateConfigUpdates({ twitch: { chatCommands: { teleport: { command: '!sg tp' } } } })
    assert.deepEqual(rejected, ['twitch.chatCommands.teleport'])
  })

  for (const value of ['x', 5, null, [], true]) {
    await t.test(`refuses chatCommands = ${JSON.stringify(value)} instead of throwing`, () => {
      const { clean, rejected } = validateConfigUpdates({ twitch: { chatCommands: value } })
      assert.deepEqual(rejected, ['twitch.chatCommands'])
      assert.equal(clean.twitch?.chatCommands === undefined, true)
    })
  }

  for (const value of ['x', null, [], true]) {
    await t.test(`refuses a single chat command = ${JSON.stringify(value)} instead of throwing`, () => {
      const { rejected } = validateConfigUpdates({ twitch: { chatCommands: { skip: value } } })
      assert.deepEqual(rejected, ['twitch.chatCommands.skip'])
    })
  }

  await t.test('accepts a valid controlCooldownSeconds', () => {
    const { clean, rejected } = validateConfigUpdates({ twitch: { chatCommands: { controlCooldownSeconds: 10 } } })
    assert.deepEqual(rejected, [])
    assert.equal(clean.twitch?.chatCommands?.controlCooldownSeconds, 10)
  })

  for (const value of [-1, 301, 'x', null]) {
    await t.test(`rejects an out-of-range or non-numeric controlCooldownSeconds = ${JSON.stringify(value)}`, () => {
      const { rejected } = validateConfigUpdates({ twitch: { chatCommands: { controlCooldownSeconds: value } } })
      assert.deepEqual(rejected, ['twitch.chatCommands.controlCooldownSeconds'])
    })
  }

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

  await t.test('merges a partial chat command update without touching sibling commands or fields', () => {
    const before = getConfig().twitch.chatCommands

    const { config } = updateConfig({ twitch: { chatCommands: { skip: { command: '!sg s' } } } })

    assert.equal(config.twitch.chatCommands.skip.command, '!sg s')
    assert.equal(config.twitch.chatCommands.skip.enabled, before.skip.enabled)
    assert.equal(config.twitch.chatCommands.skip.permission, before.skip.permission)
    assert.deepEqual(config.twitch.chatCommands.now, before.now)
    assert.deepEqual(config.twitch.chatCommands.pause, before.pause)
    assert.equal(config.twitch.chatCommands.controlCooldownSeconds, before.controlCooldownSeconds)
  })

  await t.test('merges a controlCooldownSeconds update independently of the individual commands', () => {
    updateConfig({ twitch: { chatCommands: { controlCooldownSeconds: 15 } } })
    const { config } = updateConfig({ twitch: { chatCommands: { skip: { enabled: false } } } })

    assert.equal(config.twitch.chatCommands.controlCooldownSeconds, 15)
    assert.equal(config.twitch.chatCommands.skip.enabled, false)
  })

  await t.test('does not throw on a malformed chatCommands and leaves it unchanged', () => {
    const before = getConfig().twitch.chatCommands
    const { rejected } = updateConfig({ twitch: { chatCommands: 'x' as never } })

    assert.deepEqual(rejected, ['twitch.chatCommands'])
    assert.deepEqual(getConfig().twitch.chatCommands, before)
  })
})
