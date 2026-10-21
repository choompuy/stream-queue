import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// config.json is read from process.cwd()/data at import time: keep the test away from the real one
process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

// the module exports only what production uses (the routes read and update); the tests drive the same
// update path and assert on the config that comes out of it
const { getTwitchConfig, updateTwitchConfig } = await import('../../../../src/integrations/twitch/config.js')

const DEFAULTS = getTwitchConfig()

beforeEach(() => {
  updateTwitchConfig({
    ...DEFAULTS,
    chatCommands: {
      ...DEFAULTS.chatCommands,
      now: { ...DEFAULTS.chatCommands.now },
      queue: { ...DEFAULTS.chatCommands.queue },
      skip: { ...DEFAULTS.chatCommands.skip },
      pause: { ...DEFAULTS.chatCommands.pause },
      resume: { ...DEFAULTS.chatCommands.resume }
    }
  })
})

test('updateTwitchConfig(): validation', async (t) => {
  await t.test('accepts every field the config has (a new field without a rule would be refused)', () => {
    assert.deepEqual(updateTwitchConfig(getTwitchConfig()).rejected, [])
  })

  await t.test('reports invalid top-level values by name and keeps the stored value', () => {
    const { rejected } = updateTwitchConfig({ channelPointsRewardId: 42 as never })

    assert.deepEqual(rejected, ['channelPointsRewardId'])
    assert.equal(getTwitchConfig().channelPointsRewardId, DEFAULTS.channelPointsRewardId)
  })

  await t.test('treats an empty channelPointsRewardId the same as null - "no reward selected" is valid, not invalid', () => {
    const { rejected } = updateTwitchConfig({ channelPointsRewardId: '' })

    assert.deepEqual(rejected, [])
    assert.equal(getTwitchConfig().channelPointsRewardId, null)
  })

  await t.test('trims whitespace-only channelPointsRewardId down to null too', () => {
    const { rejected } = updateTwitchConfig({ channelPointsRewardId: '   ' })

    assert.deepEqual(rejected, [])
    assert.equal(getTwitchConfig().channelPointsRewardId, null)
  })

  await t.test('accepts a real reward id and reports it with a dotted name when invalid', () => {
    assert.deepEqual(updateTwitchConfig({ channelPointsRewardId: 'reward-123' }).rejected, [])
    assert.equal(getTwitchConfig().channelPointsRewardId, 'reward-123')

    assert.deepEqual(updateTwitchConfig({ channelPointsRewardId: 42 as never }).rejected, ['channelPointsRewardId'])
    assert.equal(getTwitchConfig().channelPointsRewardId, 'reward-123', 'a refused update leaves the stored value')
  })

  await t.test('accepts a valid chat command update and normalizes it (trim, lowercase, collapse whitespace)', () => {
    const { rejected } = updateTwitchConfig({ chatCommands: { skip: { command: '  !SG   Skip  ' } } })

    assert.deepEqual(rejected, [])
    assert.equal(getTwitchConfig().chatCommands.skip.command, '!sg skip')
  })

  await t.test('rejects a chat command missing the leading "!"', () => {
    const { rejected } = updateTwitchConfig({ chatCommands: { now: { command: 'sg now' } } })
    assert.deepEqual(rejected, ['chatCommands.now.command'])
  })

  await t.test('rejects a chat command permission outside the known set', () => {
    const { rejected } = updateTwitchConfig({ chatCommands: { skip: { permission: 'vip' as never } } })
    assert.deepEqual(rejected, ['chatCommands.skip.permission'])
  })

  await t.test('rejects an unknown command key under chatCommands', () => {
    const { rejected } = updateTwitchConfig({ chatCommands: { teleport: { command: '!sg tp' } } } as never)
    assert.deepEqual(rejected, ['chatCommands.teleport'])
  })

  for (const value of ['x', 5, null, [], true]) {
    await t.test(`refuses chatCommands = ${JSON.stringify(value)} instead of throwing`, () => {
      const { rejected } = updateTwitchConfig({ chatCommands: value as never })
      assert.deepEqual(rejected, ['chatCommands'])
      assert.deepEqual(getTwitchConfig().chatCommands, DEFAULTS.chatCommands)
    })
  }

  for (const value of ['x', null, [], true]) {
    await t.test(`refuses a single chat command = ${JSON.stringify(value)} instead of throwing`, () => {
      const { rejected } = updateTwitchConfig({ chatCommands: { skip: value as never } })
      assert.deepEqual(rejected, ['chatCommands.skip'])
      assert.equal(getTwitchConfig().chatCommands.skip.command, DEFAULTS.chatCommands.skip.command)
    })
  }

  await t.test('accepts a valid controlCooldownSeconds', () => {
    const { rejected } = updateTwitchConfig({ chatCommands: { controlCooldownSeconds: 10 } })

    assert.deepEqual(rejected, [])
    assert.equal(getTwitchConfig().chatCommands.controlCooldownSeconds, 10)
  })

  for (const value of [-1, 301, 'x', null]) {
    await t.test(`rejects an out-of-range or non-numeric controlCooldownSeconds = ${JSON.stringify(value)}`, () => {
      const { rejected } = updateTwitchConfig({ chatCommands: { controlCooldownSeconds: value as never } })
      assert.deepEqual(rejected, ['chatCommands.controlCooldownSeconds'])
      assert.equal(getTwitchConfig().chatCommands.controlCooldownSeconds, DEFAULTS.chatCommands.controlCooldownSeconds)
    })
  }

  await t.test('accepts a valid plainCooldownSeconds', () => {
    const { rejected } = updateTwitchConfig({ chatCommands: { plainCooldownSeconds: 10 } })

    assert.deepEqual(rejected, [])
    assert.equal(getTwitchConfig().chatCommands.plainCooldownSeconds, 10)
  })

  for (const value of [-1, 301, 'x', null]) {
    await t.test(`rejects an out-of-range or non-numeric plainCooldownSeconds = ${JSON.stringify(value)}`, () => {
      const { rejected } = updateTwitchConfig({ chatCommands: { plainCooldownSeconds: value as never } })
      assert.deepEqual(rejected, ['chatCommands.plainCooldownSeconds'])
      assert.equal(getTwitchConfig().chatCommands.plainCooldownSeconds, DEFAULTS.chatCommands.plainCooldownSeconds)
    })
  }

  await t.test('refuses a command that collides with an unchanged one, and keeps the stored value', () => {
    const { rejected } = updateTwitchConfig({ chatCommands: { skip: { command: '!sg now' } } })

    assert.deepEqual(rejected, ['chatCommands.skip.command'])
    assert.equal(getTwitchConfig().chatCommands.skip.command, DEFAULTS.chatCommands.skip.command)
  })

  await t.test('a mutual exchange of two commands lands in one update', () => {
    const { rejected } = updateTwitchConfig({
      chatCommands: { now: { command: DEFAULTS.chatCommands.skip.command }, skip: { command: DEFAULTS.chatCommands.now.command } }
    })

    assert.deepEqual(rejected, [])
    assert.deepEqual(
      [getTwitchConfig().chatCommands.now.command, getTwitchConfig().chatCommands.skip.command],
      [DEFAULTS.chatCommands.skip.command, DEFAULTS.chatCommands.now.command]
    )
  })

  await t.test('two commands moving to the same word are both refused', () => {
    const { rejected } = updateTwitchConfig({ chatCommands: { now: { command: '!sg same' }, skip: { command: '!sg same' } } })

    assert.deepEqual([...rejected].sort(), ['chatCommands.now.command', 'chatCommands.skip.command'])
    assert.equal(getTwitchConfig().chatCommands.now.command, DEFAULTS.chatCommands.now.command)
    assert.equal(getTwitchConfig().chatCommands.skip.command, DEFAULTS.chatCommands.skip.command)
  })

  await t.test('refuses unknown fields, including prototype keys, and applies the valid ones', () => {
    const { rejected } = updateTwitchConfig(
      JSON.parse('{"foo":1,"__proto__":{"polluted":true},"constructor":1,"channelPointsRewardId":"reward-123"}') as never
    )

    assert.deepEqual(rejected.sort(), ['__proto__', 'constructor', 'foo'])
    assert.equal(getTwitchConfig().channelPointsRewardId, 'reward-123')
    assert.equal(({} as Record<string, unknown>).polluted, undefined)
  })

  await t.test('refuses a body that is not an object', () => {
    for (const body of [null, 'x', 5, [1, 2]]) assert.deepEqual(updateTwitchConfig(body as never).rejected, ['body'])
  })
})

test('updateTwitchConfig(): merging', async (t) => {
  await t.test('applies valid fields and merges a partial chat command update', () => {
    const before = getTwitchConfig().chatCommands

    const { config } = updateTwitchConfig({ chatCommands: { skip: { command: '!sg s' } } })

    assert.equal(config.chatCommands.skip?.command, '!sg s')
    assert.equal(config.chatCommands.skip?.enabled, before.skip?.enabled)
    assert.equal(config.chatCommands.skip?.permission, before.skip?.permission)
    assert.deepEqual(config.chatCommands.now, before.now)
    assert.deepEqual(config.chatCommands.queue, before.queue)
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

    assert.deepEqual(rejected, ['chatCommands.skip.command', 'chatCommands.pause.command'])
    assert.deepEqual(config.chatCommands, before)
  })

  await t.test('getConfig() hands out the live object: one snapshot per read, no per-read copy', () => {
    assert.strictEqual(getTwitchConfig(), getTwitchConfig())

    const { config } = updateTwitchConfig({})
    assert.strictEqual(config, getTwitchConfig())
  })
})
