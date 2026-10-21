import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isNetworkError, normalizeTwitchError } from '../../../../src/integrations/twitch/error.js'

const named = (name: string): Error => {
  const error = new Error('x')
  error.name = name
  return error
}

test('isNetworkError()', async (t) => {
  await t.test("undici's own wording for a lost connection counts", () => {
    assert.equal(isNetworkError(new TypeError('fetch failed')), true)
    assert.equal(isNetworkError(new TypeError('terminated')), true)
  })

  await t.test('a timeout or an abort is a lost connection too', () => {
    assert.equal(isNetworkError(named('TimeoutError')), true)
    assert.equal(isNetworkError(named('AbortError')), true)
  })

  await t.test('a TypeError of our own is a bug, not a missing connection', () => {
    assert.equal(isNetworkError(new TypeError('x is not a function')), false)
  })
})

test('normalizeTwitchError()', async (t) => {
  await t.test('a lost connection becomes a transient network error', () => {
    const normalized = normalizeTwitchError(new TypeError('fetch failed'))

    assert.equal(normalized.code, 'TWITCH_NETWORK_ERROR')
    assert.equal(normalized.params?.transient, 1)
  })

  await t.test('a bug of our own stays unknown instead of wearing the network label', () => {
    const normalized = normalizeTwitchError(new TypeError('x is not a function'))

    assert.equal(normalized.code, 'TWITCH_UNKNOWN_ERROR')
    assert.equal(normalized.params?.transient, undefined)
  })
})
