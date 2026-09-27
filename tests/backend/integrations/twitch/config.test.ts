import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// config.json is read from process.cwd()/data at import time: keep the test away from the real one
process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const { getTwitchConfig, updateTwitchConfig, validateTwitchConfigUpdates } = await import('../../../../src/integrations/twitch/config.js')

const DEFAULTS = getTwitchConfig()

beforeEach(() => {
  updateTwitchConfig({
    ...DEFAULTS,
    chatCommands: {
      ...DEFAULTS.chatCommands,
      now: { ...DEFAULTS.chatCommands.now },
      next: { ...DEFAULTS.chatCommands.next },
      skip: { ...DEFAULTS.chatCommands.skip },
      pause: { ...DEFAULTS.chatCommands.pause },
      resume: { ...DEFAULTS.chatCommands.resume }
    }
  })
})

test('validateTwitchConfigUpdates()', async (t) => {
  await t.test('accepts every field the config has (a new field without a rule would be refused)', () => {
    assert.deepEqual(validateTwitchConfigUpdates(getTwitchConfig()).rejected, [])
  })

  await t.test('reports invalid top-level values by name and keeps the valid ones', () => {
    const { clean, rejected } = validateTwitchConfigUpdates({ channelPointsRewardId: 42 })

    assert.deepEqual(rejected, ['channelPointsRewardId'])
    assert.equal('channelPointsRewardId' in clean, false)
  })

  await t.test('treats an empty channelPointsRewardId the same as null - "no reward selected" is valid, not invalid', () => {
    const { clean, rejected } = validateTwitchConfigUpdates({ channelPointsRewardId: '' })

    assert.deepEqual(rejected, [])
    assert.deepEqual(clean, { channelPointsRewardId: null })
  })

  await t.test('trims whitespace-only channelPointsRewardId down to null too', () => {
    const { clean, rejected } = validateTwitchConfigUpdates({ channelPointsRewardId: '   ' })

    assert.deepEqual(rejected, [])
    assert.deepEqual(clean, { channelPointsRewardId: null })
  })

  await t.test('accepts a real reward id and reports it with a dotted name when invalid', () => {
    const accepted = validateTwitchConfigUpdates({ channelPointsRewardId: 'reward-123' })
    assert.deepEqual(accepted.rejected, [])
    assert.deepEqual(accepted.clean, { channelPointsRewardId: 'reward-123' })

    const rejected = validateTwitchConfigUpdates({ channelPointsRewardId: 42 })
    assert.deepEqual(rejected.rejected, ['channelPointsRewardId'])
  })

  await t.test('accepts a valid chat command update and normalizes it (trim, lowercase, collapse whitespace)', () => {
    const { clean, rejected } = validateTwitchConfigUpdates({ chatCommands: { skip: { command: '  !SG   Skip  ' } } })

    assert.deepEqual(rejected, [])
    assert.deepEqual(clean.chatCommands?.skip, { command: '!sg skip' })
  })

  await t.test('rejects a chat command missing the leading "!"', () => {
    const { rejected } = validateTwitchConfigUpdates({ chatCommands: { now: { command: 'sg now' } } })
    assert.deepEqual(rejected, ['chatCommands.now.command'])
  })

  await t.test('rejects a chat command permission outside the known set', () => {
    const { rejected } = validateTwitchConfigUpdates({ chatCommands: { skip: { permission: 'vip' } } })
    assert.deepEqual(rejected, ['chatCommands.skip.permission'])
  })

  await t.test('rejects an unknown command key under chatCommands', () => {
    const { rejected } = validateTwitchConfigUpdates({ chatCommands: { teleport: { command: '!sg tp' } } })
    assert.deepEqual(rejected, ['chatCommands.teleport'])
  })

  for (const value of ['x', 5, null, [], true]) {
    await t.test(`refuses chatCommands = ${JSON.stringify(value)} instead of throwing`, () => {
      const { clean, rejected } = validateTwitchConfigUpdates({ chatCommands: value })
      assert.deepEqual(rejected, ['chatCommands'])
      assert.equal(clean.chatCommands === undefined, true)
    })
  }

  for (const value of ['x', null, [], true]) {
    await t.test(`refuses a single chat command = ${JSON.stringify(value)} instead of throwing`, () => {
      const { rejected } = validateTwitchConfigUpdates({ chatCommands: { skip: value } })
      assert.deepEqual(rejected, ['chatCommands.skip'])
    })
  }

  await t.test('accepts a valid controlCooldownSeconds', () => {
    const { clean, rejected } = validateTwitchConfigUpdates({ chatCommands: { controlCooldownSeconds: 10 } })
    assert.deepEqual(rejected, [])
    assert.equal(clean.chatCommands?.controlCooldownSeconds, 10)
  })

  for (const value of [-1, 301, 'x', null]) {
    await t.test(`rejects an out-of-range or non-numeric controlCooldownSeconds = ${JSON.stringify(value)}`, () => {
      const { rejected } = validateTwitchConfigUpdates({ chatCommands: { controlCooldownSeconds: value } })
      assert.deepEqual(rejected, ['chatCommands.controlCooldownSeconds'])
    })
  }

  await t.test('refuses unknown fields, including prototype keys', () => {
    const { clean, rejected } = validateTwitchConfigUpdates(
      JSON.parse('{"foo":1,"__proto__":{"polluted":true},"constructor":1,"channelPointsRewardId":"reward-123"}')
    )

    assert.deepEqual(rejected.sort(), ['__proto__', 'constructor', 'foo'])
    assert.deepEqual(clean, { channelPointsRewardId: 'reward-123' })
    assert.equal(({} as Record<string, unknown>).polluted, undefined)
  })

  await t.test('refuses a body that is not an object', () => {
    for (const body of [null, 'x', 5, [1, 2]]) assert.deepEqual(validateTwitchConfigUpdates(body).rejected, ['body'])
  })
})

test('updateTwitchConfig()', async (t) => {
  await t.test('applies valid fields and merges a partial chat command update', () => {
    const before = getTwitchConfig().chatCommands

    const { config } = updateTwitchConfig({ chatCommands: { skip: { command: '!sg s' } } })

    assert.equal(config.chatCommands.skip?.command, '!sg s')
    assert.equal(config.chatCommands.skip?.enabled, before.skip?.enabled)
    assert.equal(config.chatCommands.skip?.permission, before.skip?.permission)
    assert.deepEqual(config.chatCommands.now, before.now)
    assert.deepEqual(config.chatCommands.pause, before.pause)
    assert.equal(config.chatCommands.controlCooldownSeconds, before.controlCooldownSeconds)
  })

  await t.test('merges a controlCooldownSeconds update independently of the individual commands', () => {
    updateTwitchConfig({ chatCommands: { controlCooldownSeconds: 15 } })
    const { config } = updateTwitchConfig({ chatCommands: { skip: { enabled: false } } })

    assert.equal(config.chatCommands.controlCooldownSeconds, 15)
    assert.equal(config.chatCommands.skip?.enabled, false)
  })

  await t.test('does not throw on a malformed chatCommands and leaves it unchanged', () => {
    const before = getTwitchConfig().chatCommands
    const { rejected } = updateTwitchConfig({ chatCommands: 'x' as never })

    assert.deepEqual(rejected, ['chatCommands'])
    assert.deepEqual(getTwitchConfig().chatCommands, before)
  })

  await t.test('rejects duplicate command strings between different actions', () => {
    const before = getTwitchConfig().chatCommands

    const { config, rejected } = updateTwitchConfig({
      chatCommands: {
        skip: { command: '!sg action' },
        pause: { command: '!sg action' }
      }
    })

    assert.deepEqual(rejected, ['chatCommands.skip.command', 'chatCommands.pause.command', 'chatCommands (duplicate command text: !sg action)'])
    assert.deepEqual(config.chatCommands, before)
  })

  await t.test('returns copies: mutating a result does not change the stored config', () => {
    const { config } = updateTwitchConfig({})
    const originalChannelPointsRewardId = config.channelPointsRewardId

    // Mutate the returned config (primitive value to test top-level cloning)
    config.channelPointsRewardId = 'modified'

    // The stored config should have the original value
    assert.equal(getTwitchConfig().channelPointsRewardId, originalChannelPointsRewardId)
  })
})
