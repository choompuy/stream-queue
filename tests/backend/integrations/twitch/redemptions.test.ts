import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const workDir = mkdtempSync(join(tmpdir(), 'streamqueue-test-'))
cpSync(resolve('public/locales'), join(workDir, 'public/locales'), { recursive: true })
process.chdir(workDir)

const { _resetIntegration, initializeTwitchIntegration, disconnect } = await import('../../../../src/integrations/twitch/index.js')
const { isRetryable } = await import('../../../../src/integrations/twitch/error.js')
const { cancelRedemption, fulfillRedemption, handleChannelPointsRedemption } = await import('../../../../src/integrations/twitch/redemptions.js')
const { chatConnection, twitchBackoff } = await import('../../../../src/integrations/twitch/state.js')
const { buildRedemptionRejectionMessage, buildRedemptionRefundFailedMessage } = await import('../../../../src/chat-replies.js')
const { AppError } = await import('../../../../src/types.js')
const { updateTwitchOAuthState, updateSecrets } = await import('../../../../src/secrets.js')
const { blockTrack, unblockTrack } = await import('../../../../src/blocklist.js')
const { updateTwitchConfig } = await import('../../../../src/integrations/twitch/config.js')
const queue = await import('../../../../src/queue.js')
import type { TwitchChat } from '../../../../src/integrations/twitch/chat.js'
import type { TwitchClient } from '../../../../src/integrations/twitch/client.js'
import type { FailureReason } from '../../../../src/types.js'

const redemption = { id: 'red-1', rewardId: 'reward-1', userName: 'viewer' }
// the reason a redemption is canceled travels as a plain { code, params }, not as a thrown AppError
const reason: FailureReason = { code: 'PLAYBACK_FAILED' }
const refunded = () => buildRedemptionRejectionMessage('viewer', reason, 'en')
const refundFailed = () => buildRedemptionRefundFailedMessage('viewer', 'en')

// the song requests below reach the YouTube layer, which needs a key to get past its own gate
updateSecrets({ youtubeApiKey: 'test-key' })

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
  twitchBackoff.delayMs = 1
  chatConnection.instance = { isConnected: () => true, disconnect: async () => {}, sendMessage: async (message: string) => void sent.push(message) } as unknown as TwitchChat
})

after(async () => {
  chatConnection.instance = null
  await _resetIntegration()
})

test('isRetryable()', async (t) => {
  await t.test('a lost connection and a timeout are repeated (they arrive as plain errors)', () => {
    assert.equal(isRetryable(new TypeError('fetch failed')), true)
    assert.equal(isRetryable(new DOMException('timed out', 'TimeoutError')), true)
  })

  await t.test('a plain error that is not a network failure is a bug, and is not repeated', () => {
    assert.equal(isRetryable(new Error('a bug of ours')), false)
    assert.equal(isRetryable('not even an error'), false)
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
    await cancelRedemption(redemption, fakeClient('ok'), reason)
    assert.deepEqual(sent, [refunded()])
    assert.deepEqual(calls, ['CANCELED'])
  })

  await t.test('a passing failure is repeated and then confirmed', async () => {
    await cancelRedemption(redemption, fakeClient(api(503), new TypeError('fetch failed'), 'ok'), reason)
    assert.equal(calls.length, 3)
    assert.deepEqual(sent, [refunded()])
  })

  await t.test('a redemption that is no longer open (404) is left alone: one try, nothing is said in chat', async () => {
    await cancelRedemption(redemption, fakeClient(api(404)), reason)
    assert.equal(calls.length, 1)
    assert.deepEqual(sent, [])
  })

  await t.test('a refusal (403, and 400 which is a wrong request) is one try and the refund is reported as failed', async () => {
    for (const status of [400, 403]) {
      calls = []
      sent = []
      await cancelRedemption(redemption, fakeClient(api(status)), reason)
      assert.equal(calls.length, 1, String(status))
      assert.deepEqual(sent, [refundFailed()], String(status))
    }
  })

  await t.test('a login that is gone is one try, not three', async () => {
    await cancelRedemption(redemption, fakeClient(new AppError('TWITCH_NOT_CONNECTED', 'not connected')), reason)
    assert.equal(calls.length, 1)
    assert.deepEqual(sent, [refundFailed()])
  })

  await t.test('after three failed tries the refund is reported as failed, never as done', async () => {
    await cancelRedemption(redemption, fakeClient(api(503)), reason)
    assert.equal(calls.length, 3)
    assert.deepEqual(sent, [refundFailed()])
  })
})

test('fulfillRedemption()', async (t) => {
  await t.test('a redemption that is no longer open is one try and no error', async () => {
    await fulfillRedemption(redemption, fakeClient(api(404)))
    assert.deepEqual(calls, ['FULFILLED'])
  })

  await t.test('when it cannot be fulfilled it is left open, not canceled (the song was played)', async () => {
    await fulfillRedemption(redemption, fakeClient(api(503)))
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

test('handleChannelPointsRedemption()', async (t) => {
  const event = (id: string, userInput: string) => ({
    id,
    user_name: 'viewer',
    user_input: userInput,
    reward: { id: 'reward-1', title: 'Song request' }
  })

  t.beforeEach(() => {
    initializeTwitchIntegration({ clientId: 'client-1' })
    updateTwitchConfig({ channelPointsRewardId: 'reward-1' })
    twitchBackoff.delayMs = 1
    calls = []
  })

  t.after(() => {
    chatConnection.instance = null
  })

  await t.test('a redemption of another reward is ignored at debug level and not touched', async (t2) => {
    const debug = t2.mock.method(console, 'log', () => {})
    const errors = t2.mock.method(console, 'error', () => {})

    await handleChannelPointsRedemption({ ...event('red-other', 'song'), reward: { id: 'another-reward', title: 'Other' } } as never, fakeClient('ok'))

    assert.deepEqual(calls, [], 'no status update for a foreign reward')
    assert.equal(debug.mock.callCount(), 0, 'a debug line is below the default info level and does not show')
    assert.equal(errors.mock.callCount(), 0)
  })

  await t.test('an ordinary refusal (a blocked track) is a warning, not an error, and refunds the points', async (t2) => {
    const warnings = t2.mock.method(console, 'warn', () => {})
    const errors = t2.mock.method(console, 'error', () => {})
    const A = 'aaaaaaaaaaa'
    blockTrack(A, 'blocked')

    await handleChannelPointsRedemption(event('red-block', `https://www.youtube.com/watch?v=${A}`) as never, fakeClient('ok'))

    assert.deepEqual(calls, ['CANCELED'])
    assert.equal(warnings.mock.callCount(), 1)
    assert.equal(errors.mock.callCount(), 0, 'a viewer asking for a blocked track is not an application error')

    unblockTrack(A)
  })

  // YouTube is stubbed, so a request can actually be accepted: the fetch answers fail in a way that is nobody's
  // refusal (a broken row from the videos endpoint) and the request becomes an unexpected error
  const realFetch = globalThis.fetch
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

  await t.test('an unexpected request failure is logged once, and the viewer gets the generic refund message', async (t2) => {
    const errors = t2.mock.method(console, 'error', () => {})
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input))
      if (url.hostname !== 'www.googleapis.com') return realFetch(input, init)
      return url.pathname.endsWith('/search') ? json({ items: [{ id: { videoId: 'aaaaaaaaaaa' } }] }) : json({ items: [null] })
    }) as typeof fetch

    try {
      await handleChannelPointsRedemption(event('red-broken', 'some song') as never, fakeClient('ok'))
    } finally {
      globalThis.fetch = realFetch
    }

    assert.equal(errors.mock.callCount(), 1, 'the handler that owns the request logs the outage, nobody else')
    assert.deepEqual(calls, ['CANCELED'])
    assert.deepEqual(sent, [buildRedemptionRejectionMessage('viewer', { code: 'SERVER_ERROR' }, 'en')])
  })

  await t.test('a failure after the track is queued does not refund the points', async () => {
    // a token in storage makes the account look authenticated, so the flow reaches the chat reply
    await _resetIntegration()
    updateTwitchOAuthState({ tokenData: { accessToken: 'token', refreshToken: 'refresh', expiresAt: Date.now() + 3600_000, scope: [] } })
    initializeTwitchIntegration({ clientId: 'client-1' })
    updateTwitchConfig({ channelPointsRewardId: 'reward-1' })

    queue.clearQueue()
    queue.setCurrent(null)

    // the chat connection breaks while the acceptance reply is being sent: the song is already playing
    chatConnection.instance = {
      isConnected: () => {
        throw new Error('chat blew up')
      },
      disconnect: async () => {},
      sendMessage: async () => {}
    } as unknown as TwitchChat

    const A = 'aaaaaaaaaaa'
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input))
      if (url.hostname !== 'www.googleapis.com') return realFetch(input, init)
      return json({
        items: [
          {
            id: A,
            snippet: { title: `Song ${A}`, channelTitle: 'Channel', categoryId: '10', thumbnails: { medium: { url: 'https://img/x.jpg' } } },
            contentDetails: { duration: 'PT3M20S' },
            statistics: { viewCount: '1000000' }
          }
        ]
      })
    }) as typeof fetch

    try {
      // the broken chat must escape the handler instead of being mistaken for a failed request
      await assert.rejects(
        handleChannelPointsRedemption(event('red-late', `https://www.youtube.com/watch?v=${A}`) as never, fakeClient('ok')),
        /chat blew up/
      )
    } finally {
      globalThis.fetch = realFetch
      chatConnection.instance = null
      await _resetIntegration()
      updateTwitchOAuthState({ tokenData: null })
    }

    // the points were spent: the redemption was not canceled, and the track keeps playing with its reward open
    assert.deepEqual(calls, [])
    assert.equal(queue.getCurrent()?.videoId, A)
    assert.equal(queue.getCurrent()?.channelPointsRedemption?.id, 'red-late')
  })
})
