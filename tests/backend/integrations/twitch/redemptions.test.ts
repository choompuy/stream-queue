import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const { isRetryable, _test, _resetIntegration, initializeTwitchIntegration, disconnect } = await import('../../../../src/integrations/twitch/index.js')
const { buildRedemptionRejectionMessage, buildRedemptionRefundFailedMessage } = await import('../../../../src/chat-replies.js')
const { AppError } = await import('../../../../src/types.js')
const queue = await import('../../../../src/queue.js')
import type { TwitchChat } from '../../../../src/integrations/twitch/chat.js'
import type { TwitchClient } from '../../../../src/integrations/twitch/client.js'

const redemption = { id: 'red-1', rewardId: 'reward-1', userName: 'viewer' }
const reason = { code: 'PLAYBACK_FAILED' } as const
const refunded = () => buildRedemptionRejectionMessage('viewer', reason)
const refundFailed = () => buildRedemptionRefundFailedMessage('viewer')

const api = (status: number, code = 'TWITCH_API_ERROR') => new AppError(code as 'TWITCH_API_ERROR', `Twitch answered ${status}`, { status })

let sent: string[] = []
let calls: string[] = []

// a Twitch client that answers each call from the list (the last answer repeats): an Error is thrown, anything else is a success
function fakeClient(...answers: unknown[]): TwitchClient {
  let call = 0
  return {
    updateRedemptionStatus: async (_ref: unknown, status: string) => {
      calls.push(status)
      const answer = answers[Math.min(call++, answers.length - 1)]
      if (answer instanceof Error) throw answer
    }
  } as unknown as TwitchClient
}

beforeEach(() => {
  sent = []
  calls = []
  _test.setRetryDelay(1)
  _test.setChat({ isConnected: () => true, disconnect: async () => {}, sendMessage: async (message: string) => void sent.push(message) } as unknown as TwitchChat)
})

after(async () => {
  _test.setChat(null)
  await _resetIntegration()
})

test('isRetryable()', async (t) => {
  await t.test('a lost connection and a timeout are repeated (they arrive as plain errors)', () => {
    assert.equal(isRetryable(new TypeError('fetch failed')), true)
    assert.equal(isRetryable(new DOMException('timed out', 'TimeoutError')), true)
  })

  await t.test('429 and 5xx are repeated', () => {
    for (const status of [429, 500, 502, 503]) assert.equal(isRetryable(api(status)), true, String(status))
  })

  await t.test('a refusal is not repeated', () => {
    for (const status of [400, 401, 403, 404]) assert.equal(isRetryable(api(status)), false, String(status))
  })

  await t.test('no login, or a login Twitch refuses, is not repeated; a login that could not be refreshed just now is', () => {
    assert.equal(isRetryable(new AppError('TWITCH_NOT_CONNECTED', 'not connected')), false)
    assert.equal(isRetryable(new AppError('TWITCH_REFRESH_ERROR', 'refused')), false)
    assert.equal(isRetryable(new AppError('TWITCH_NOT_CONNECTED', 'later', { transient: 1 })), true)
    assert.equal(isRetryable(new AppError('TWITCH_REFRESH_ERROR', 'later', { transient: 1 })), true)
  })
})

test('cancelRedemption()', async (t) => {
  await t.test('a confirmed refund says so in chat', async () => {
    await _test.cancelRedemption(redemption, fakeClient('ok'), reason)
    assert.deepEqual(sent, [refunded()])
    assert.deepEqual(calls, ['CANCELED'])
  })

  await t.test('a passing failure is repeated and then confirmed', async () => {
    await _test.cancelRedemption(redemption, fakeClient(api(503), new TypeError('fetch failed'), 'ok'), reason)
    assert.equal(calls.length, 3)
    assert.deepEqual(sent, [refunded()])
  })

  await t.test('a redemption that is no longer open (404) is left alone: one try, nothing is said in chat', async () => {
    await _test.cancelRedemption(redemption, fakeClient(api(404)), reason)
    assert.equal(calls.length, 1)
    assert.deepEqual(sent, [])
  })

  await t.test('a refusal (403, and 400 which is a wrong request) is one try and the refund is reported as failed', async () => {
    for (const status of [400, 403]) {
      calls = []
      sent = []
      await _test.cancelRedemption(redemption, fakeClient(api(status)), reason)
      assert.equal(calls.length, 1, String(status))
      assert.deepEqual(sent, [refundFailed()], String(status))
    }
  })

  await t.test('a login that is gone is one try, not three', async () => {
    await _test.cancelRedemption(redemption, fakeClient(new AppError('TWITCH_NOT_CONNECTED', 'not connected')), reason)
    assert.equal(calls.length, 1)
    assert.deepEqual(sent, [refundFailed()])
  })

  await t.test('after three failed tries the refund is reported as failed, never as done', async () => {
    await _test.cancelRedemption(redemption, fakeClient(api(503)), reason)
    assert.equal(calls.length, 3)
    assert.deepEqual(sent, [refundFailed()])
  })
})

test('fulfillRedemption()', async (t) => {
  await t.test('a redemption that is no longer open is one try and no error', async () => {
    await _test.fulfillRedemption(redemption, fakeClient(api(404)))
    assert.deepEqual(calls, ['FULFILLED'])
  })

  await t.test('when it cannot be fulfilled it is left open, not canceled (the song was played)', async () => {
    await _test.fulfillRedemption(redemption, fakeClient(api(503)))
    assert.deepEqual(calls, ['FULFILLED', 'FULFILLED', 'FULFILLED'])
    assert.deepEqual(sent, [])
  })
})

test('disconnect()', async (t) => {
  await t.test('without an integration there is nothing left open', async () => {
    await _resetIntegration()
    assert.equal(await disconnect(), 0)
  })

  await t.test('reports how many queued redemptions it left on Twitch, and detaches them', async () => {
    initializeTwitchIntegration({ clientId: 'client-1' })
    const song = { title: 'T', channelTitle: 'c', thumbnail: '', duration: 200, views: 1, url: 'u' }
    queue.hydrateQueue({
      current: { ...song, videoId: 'aaaaaaaaaaa', requestedBy: 'a', channelPointsRedemption: { id: 'r1', rewardId: 'w', userName: 'a' } },
      queue: [
        { ...song, videoId: 'bbbbbbbbbbb', requestedBy: 'b', channelPointsRedemption: { id: 'r2', rewardId: 'w', userName: 'b' } },
        { ...song, videoId: 'ccccccccccc', requestedBy: 'c' }
      ]
    })

    assert.equal(await disconnect(), 2)
    assert.equal(queue.getCurrent()?.channelPointsRedemption, undefined)
    assert.equal(queue.getQueue().every((item) => item.channelPointsRedemption === undefined), true)
    assert.equal(await disconnect(), 0, 'a second disconnect finds nothing to leave')
  })
})
