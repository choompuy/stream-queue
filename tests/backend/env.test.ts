import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getTwitchClientId } from '../../src/env.js'

test('getTwitchClientId()', async (t) => {
  await t.test('returns an empty string, not a throw, when TWITCH_CLIENT_ID is unset', () => {
    delete process.env.TWITCH_CLIENT_ID
    assert.equal(getTwitchClientId(), '')
  })

  await t.test('trims surrounding whitespace', () => {
    process.env.TWITCH_CLIENT_ID = '  abc123  '
    assert.equal(getTwitchClientId(), 'abc123')
  })

  await t.test('a whitespace-only value is treated as unset', () => {
    process.env.TWITCH_CLIENT_ID = '   '
    assert.equal(getTwitchClientId(), '')
  })
})
