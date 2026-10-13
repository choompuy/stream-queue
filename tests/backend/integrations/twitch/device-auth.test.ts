import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const { initializeTwitchIntegration, startDeviceAuthorization, disconnect, _test, _resetIntegration } = await import('../../../../src/integrations/twitch/index.js')
const { updateTwitchConfig } = await import('../../../../src/integrations/twitch/config.js')
const { clearTwitchOAuthState } = await import('../../../../src/secrets.js')
import type { TwitchClient } from '../../../../src/integrations/twitch/client.js'

const originalFetch = globalThis.fetch
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let deviceRequests = 0
let slowFirstCode: Promise<void> | null = null
let granted = new Set<string>()
let polledCodes: string[] = []
let userInfoRequests = 0

// A Twitch that hands out the codes code-1, code-2, ... A login ends when the test puts its code into `granted`
beforeEach(async () => {
  deviceRequests = 0
  slowFirstCode = null
  granted = new Set()
  polledCodes = []
  userInfoRequests = 0

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)

    if (url.includes('/oauth2/device')) {
      const n = ++deviceRequests
      if (n === 1 && slowFirstCode) await slowFirstCode
      return json({ device_code: `code-${n}`, user_code: `USER-${n}`, verification_uri: 'https://www.twitch.tv/activate', expires_in: 1, interval: 0.05 })
    }

    if (url.includes('/oauth2/token')) {
      const code = new URLSearchParams(String(init?.body)).get('device_code') ?? ''
      polledCodes.push(code)
      if (granted.has(code)) return json({ access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: [], token_type: 'bearer' })
      return json({ status: 400, message: 'authorization_pending' }, 400)
    }

    if (url.includes('/helix/users')) {
      userInfoRequests++
      return json({ data: [{ id: '1', login: 'amy', display_name: 'Amy', profile_image_url: '' }] })
    }

    throw new Error(`unexpected request: ${url}`)
  }) as typeof fetch

  await _resetIntegration()
  clearTwitchOAuthState()
  initializeTwitchIntegration({ clientId: 'client-1' })
})

afterEach(async () => {
  globalThis.fetch = originalFetch
  await _resetIntegration()
  clearTwitchOAuthState()
})

test('device authorization', async (t) => {
  await t.test('a new start replaces the one that is still waiting, instead of failing with "already in progress"', async () => {
    const first = await startDeviceAuthorization()
    const second = await startDeviceAuthorization()

    assert.equal(first.user_code, 'USER-1')
    assert.equal(second.user_code, 'USER-2')
  })

  await t.test('the code that was replaced is not used when it is entered after all', async () => {
    await startDeviceAuthorization()
    await startDeviceAuthorization()

    granted.add('code-1')
    await sleep(250)

    assert.ok(polledCodes.includes('code-1'), 'the old code is still polled, Twitch cannot be told to stop')
    assert.equal(userInfoRequests, 0, 'but nothing is taken over from it')
  })

  await t.test('a start that is replaced while its code is being requested ends with an error, and its code is never polled', async () => {
    let releaseFirstCode!: () => void
    slowFirstCode = new Promise<void>((resolve) => (releaseFirstCode = resolve))

    const first = startDeviceAuthorization()
    const firstOutcome = first.then(
      () => 'started',
      (error: Error) => error.message
    )
    const second = await startDeviceAuthorization()
    releaseFirstCode()

    assert.equal(second.user_code, 'USER-2')
    assert.match(await firstOutcome, /cancelled/)

    await sleep(150)
    assert.equal(polledCodes.includes('code-1'), false)
    assert.equal(polledCodes.includes('code-2'), true)
  })

  await t.test('disconnect() gives up a login that is still waiting for the code', async () => {
    await startDeviceAuthorization()
    await disconnect()

    granted.add('code-1')
    await sleep(250)

    assert.equal(userInfoRequests, 0)
  })
})

const event = (id: string, userInput = '') => ({ id, user_name: 'viewer', user_input: userInput, reward: { id: 'reward-1', title: 'Song request' } })

test('the same redemption delivered twice is taken once', async (t) => {
  updateTwitchConfig({ channelPointsRewardId: 'reward-1' })
  _test.setRetryDelay(1)

  await t.test('the second delivery of one id is ignored, another id is not', async () => {
    const calls: string[] = []
    const client = { updateRedemptionStatus: async (_redemption: unknown, status: string) => void calls.push(status) } as unknown as TwitchClient

    // an empty request is refunded at once, which is what makes a handled redemption visible here
    await _test.handleChannelPointsRedemption(event('red-1') as never, client)
    await _test.handleChannelPointsRedemption(event('red-1') as never, client)
    assert.deepEqual(calls, ['CANCELED'])

    await _test.handleChannelPointsRedemption(event('red-2') as never, client)
    assert.deepEqual(calls, ['CANCELED', 'CANCELED'])
  })
})
