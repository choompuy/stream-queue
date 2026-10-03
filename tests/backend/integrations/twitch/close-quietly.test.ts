import { test } from 'node:test'
import assert from 'node:assert/strict'
import WebSocket from 'ws'
import { closeQuietly } from '../../../../src/integrations/twitch/socket.js'

test('closeQuietly()', async (t) => {
  await t.test('closing a socket that is still connecting does not raise an unhandled error', async () => {
    const uncaught: Error[] = []
    const record = (error: Error) => uncaught.push(error)
    process.on('uncaughtException', record)

    try {
      closeQuietly(new WebSocket('ws://127.0.0.1:9')) // nothing listens there: the socket is CONNECTING when it is closed
      await new Promise((resolve) => setTimeout(resolve, 300))
    } finally {
      process.off('uncaughtException', record)
    }

    assert.deepEqual(uncaught.map((error) => error.message), [])
  })

  await t.test('null and undefined are accepted', () => {
    assert.doesNotThrow(() => closeQuietly(null))
    assert.doesNotThrow(() => closeQuietly(undefined))
  })
})
