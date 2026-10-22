import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const { initializeTwitchIntegration, startDeviceAuthorization, disconnect, stop, describeAuthorization } =
  await import('../../../../src/integrations/twitch/index.js')
const { handleChannelPointsRedemption } = await import('../../../../src/integrations/twitch/redemptions.js')
const { updateTwitchConfig } = await import('../../../../src/integrations/twitch/config.js')
const { clearTwitchOAuthState, getSecrets, getPublicSecretsView } = await import('../../../../src/secrets.js')
const { onNotice } = await import('../../../../src/state-events.js')
import type { TwitchClient } from '../../../../src/integrations/twitch/client.js'

const originalFetch = globalThis.fetch
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let deviceRequests = 0
let slowFirstCode: Promise<void> | null = null
let granted = new Set<string>()
let polledCodes: string[] = []
let userInfoRequests = 0
let revokedTokens: string[] = []
let tokenGate: Promise<void> | null = null // holds back the answer to a poll of code-1
let userInfoRefusal: Response | null = null // when set, /helix/users answers with this instead of a user

// A Twitch that hands out the codes code-1, code-2, ... A login ends when the test puts its code into `granted`
beforeEach(async () => {
  deviceRequests = 0
  slowFirstCode = null
  granted = new Set()
  polledCodes = []
  userInfoRequests = 0
  revokedTokens = []
  tokenGate = null
  userInfoRefusal = null

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)

    if (url.includes('/oauth2/device')) {
      const n = ++deviceRequests
      if (n === 1 && slowFirstCode) await slowFirstCode
      return json({
        device_code: `code-${n}`,
        user_code: `USER-${n}`,
        verification_uri: 'https://www.twitch.tv/activate',
        expires_in: 1,
        interval: 0.05
      })
    }

    if (url.includes('/oauth2/token')) {
      const code = new URLSearchParams(String(init?.body)).get('device_code') ?? ''
      polledCodes.push(code)
      if (code === 'code-1' && tokenGate) await tokenGate
      if (granted.has(code)) return json({ access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: [], token_type: 'bearer' })
      return json({ status: 400, message: 'authorization_pending' }, 400)
    }

    if (url.includes('/oauth2/revoke')) {
      revokedTokens.push(new URLSearchParams(String(init?.body)).get('token') ?? '')
      return json({})
    }

    if (url.includes('/helix/users')) {
      userInfoRequests++
      if (userInfoRefusal) return userInfoRefusal
      return json({ data: [{ id: '1', login: 'amy', display_name: 'Amy', profile_image_url: '' }] })
    }

    throw new Error(`unexpected request: ${url}`)
  }) as typeof fetch

  await stop()
  clearTwitchOAuthState()
  // the small retry delay keeps the getUserInfo retries of some subtests fast - an option of the
  // initialization, not a knob of the state a test pokes at
  initializeTwitchIntegration({ clientId: 'client-1' }, { retryDelayMs: 1 })
})

afterEach(async () => {
  globalThis.fetch = originalFetch
  await stop()
  clearTwitchOAuthState()
})

test('device authorization', async (t) => {
  await t.test('a new start replaces the one that is still waiting, instead of failing with "already in progress"', async () => {
    const first = await startDeviceAuthorization()
    const second = await startDeviceAuthorization()

    assert.equal(first.user_code, 'USER-1')
    assert.equal(second.user_code, 'USER-2')
  })

  await t.test('the code that was replaced is not polled any more, and nothing is taken over from it', async () => {
    await startDeviceAuthorization()
    await startDeviceAuthorization()

    granted.add('code-1')
    await sleep(250)

    assert.equal(polledCodes.includes('code-1'), false, 'the old login stops asking Twitch as soon as it is replaced')
    assert.equal(userInfoRequests, 0)
    assert.equal(getSecrets().twitch.tokenData, null)
  })

  await t.test('a code entered while its replacement is already there gives no tokens to anyone, and Twitch is told to forget them', async () => {
    let enterCode!: () => void
    tokenGate = new Promise<void>((resolve) => (enterCode = resolve))
    granted.add('code-1')

    await startDeviceAuthorization()
    await sleep(120) // the old login asks Twitch, and waits for the answer
    assert.ok(polledCodes.includes('code-1'))

    await startDeviceAuthorization() // replaces it while the answer is on its way
    enterCode()
    await sleep(120)

    assert.deepEqual(revokedTokens.sort(), ['a', 'r'])
    assert.equal(getSecrets().twitch.tokenData, null, 'the tokens of the cancelled login are not kept')
    assert.equal(userInfoRequests, 0)
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

  await t.test('while the login waits, the code is written down for the panel (also for a reloaded one), and a replacement writes its own', async () => {
    assert.equal(getPublicSecretsView({ includeAuthorization: true }).twitch.authorization, null)

    await startDeviceAuthorization()
    const first = getPublicSecretsView({ includeAuthorization: true }).twitch.authorization
    assert.equal(first?.userCode, 'USER-1')
    assert.equal(first?.verificationUri, 'https://www.twitch.tv/activate')
    assert.ok((first?.expiresAt ?? 0) > Date.now())

    await startDeviceAuthorization()
    assert.equal(getPublicSecretsView({ includeAuthorization: true }).twitch.authorization?.userCode, 'USER-2')
  })

  await t.test('the code of a start that was replaced while it was requested is never written', async () => {
    let releaseFirstCode!: () => void
    slowFirstCode = new Promise<void>((resolve) => (releaseFirstCode = resolve))

    const first = startDeviceAuthorization().catch(() => {})
    await startDeviceAuthorization()
    releaseFirstCode()
    await first

    assert.equal(getPublicSecretsView({ includeAuthorization: true }).twitch.authorization?.userCode, 'USER-2')
  })

  await t.test('the code is removed when the login ends by itself (nobody entered it in time)', async () => {
    await startDeviceAuthorization()
    assert.equal(getPublicSecretsView({ includeAuthorization: true }).twitch.authorization?.userCode, 'USER-1')

    // the fake Twitch gives every code one second
    await sleep(1400)

    assert.equal(getPublicSecretsView({ includeAuthorization: true }).twitch.authorization, null)
  })

  await t.test('how the login ended is told to the panel: the code expired, and the news lasts until the next login starts', async () => {
    const device = await startDeviceAuthorization()

    // the fake Twitch gives every code one second
    await sleep(1400)

    // what the status route answers: the outcome of the login, with the deadline the code had
    assert.deepEqual(describeAuthorization(null), { state: 'expired', expiresAt: device.expiresAt })

    await startDeviceAuthorization()
    assert.equal(describeAuthorization(null), null, 'a login that started anew has no news of an old one')
  })

  await t.test('disconnect() removes the code and gives up a login that is still waiting for it', async () => {
    await startDeviceAuthorization()
    await disconnect()

    assert.equal(getPublicSecretsView({ includeAuthorization: true }).twitch.authorization, null)
  })

  await t.test('disconnect() gives up a login that is still waiting for the code', async () => {
    await startDeviceAuthorization()
    await disconnect()

    granted.add('code-1')
    await sleep(250)

    assert.equal(userInfoRequests, 0)
    assert.equal(getSecrets().twitch.tokenData, null)
  })
})

test('a login whose account details cannot be fetched is rolled back and reported to the panel', async (t) => {
  await t.test('Twitch is told to forget the tokens, nothing stays on disk, and the panel learns why', async () => {
    // a 403 is a refusal that a retry does not change: it must not be repeated
    userInfoRefusal = json({ message: 'not yours' }, 403)

    const notices: Array<{ type: string; code?: string; params?: Record<string, unknown> }> = []
    const off = onNotice((notice) => notices.push(notice))

    await startDeviceAuthorization()
    granted.add('code-1')
    await sleep(250)

    assert.equal(userInfoRequests, 1, 'a hopeless 4xx is not retried')
    assert.deepEqual(revokedTokens.sort(), ['a', 'r'], 'Twitch is told to forget the tokens it just gave')
    assert.equal(getSecrets().twitch.tokenData, null, 'a revoked token does not stay in secrets.json for the next start')
    assert.equal(getPublicSecretsView().twitch.connected, false)
    assert.ok(
      notices.some((notice) => notice.type === 'error' && notice.code === 'TWITCH_API_ERROR' && notice.params?.message === 'not yours'),
      'the panel is told the error that ended the login'
    )

    off()
  })

  await t.test('a passing failure is retried while attempts are left, then rolled back the same way', async () => {
    userInfoRefusal = json({ message: 'having a moment' }, 503)

    await startDeviceAuthorization()
    granted.add('code-1')
    await sleep(250)

    assert.equal(userInfoRequests, 3, 'a 5xx is worth another attempt, a 4xx is not')
    assert.deepEqual(revokedTokens.sort(), ['a', 'r'])
    assert.equal(getSecrets().twitch.tokenData, null)
  })
})

const event = (id: string, userInput = '') => ({ id, user_name: 'viewer', user_input: userInput, reward: { id: 'reward-1', title: 'Song request' } })

test('the same redemption delivered twice is taken once', async (t) => {
  updateTwitchConfig({ channelPointsRewardId: 'reward-1' })

  await t.test('the second delivery of one id is ignored, another id is not', async () => {
    const calls: string[] = []
    const client = { updateRedemptionStatus: async (_redemption: unknown, status: string) => void calls.push(status) } as unknown as TwitchClient

    // an empty request is refunded at once, which is what makes a handled redemption visible here
    await handleChannelPointsRedemption(event('red-1') as never, client)
    await handleChannelPointsRedemption(event('red-1') as never, client)
    assert.deepEqual(calls, ['CANCELED'])

    await handleChannelPointsRedemption(event('red-2') as never, client)
    assert.deepEqual(calls, ['CANCELED', 'CANCELED'])
  })
})
