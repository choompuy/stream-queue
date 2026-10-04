import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { TwitchOAuth } from '../../../../src/integrations/twitch/oauth.js'

const realFetch = globalThis.fetch
after(() => {
  globalThis.fetch = realFetch
})

type Sent = { url: string; body: URLSearchParams }
let sent: Sent[] = []

function stub(handler: () => Response | Error): void {
  sent = []
  globalThis.fetch = async (input, init) => {
    const body = new URLSearchParams(String(init?.body ?? ''))
    sent.push({ url: String(input instanceof Request ? input.url : input), body })

    const answer = handler()
    if (answer instanceof Error) throw answer
    return answer
  }
}

const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// a login whose access token has already run out, so every use has to refresh it first
function expiredLogin(): TwitchOAuth {
  const oauth = new TwitchOAuth({ clientId: 'client-1' })
  oauth.setTokenData({ accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: Date.now() - 1000, scope: [] })
  return oauth
}

beforeEach(() => {
  sent = []
})

test('a refused refresh token', async (t) => {
  await t.test('is remembered, and later calls do not go out to Twitch again', async () => {
    stub(() => json(400, { status: 400, message: 'Invalid refresh token' }))
    const oauth = expiredLogin()

    assert.equal(await oauth.getValidAccessToken(), null)
    assert.equal(oauth.needsReauthorization(), true)
    assert.equal(sent.length, 1)

    assert.equal(await oauth.getValidAccessToken(), null)
    await assert.rejects(oauth.refreshAccessToken(), /connect the account again/)
    assert.equal(sent.length, 1, 'no second request with a token Twitch already refused')
  })

  await t.test('a server error or a lost connection is not that: the next call tries again', async () => {
    const oauth = expiredLogin()

    stub(() => json(503))
    assert.equal(await oauth.getValidAccessToken(), null)
    assert.equal(oauth.needsReauthorization(), false)

    stub(() => new TypeError('fetch failed'))
    assert.equal(await oauth.getValidAccessToken(), null)
    assert.equal(oauth.needsReauthorization(), false)

    stub(() => json(200, { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, scope: [], token_type: 'bearer' }))
    assert.equal(await oauth.getValidAccessToken(), 'new-access')
    assert.equal(sent.length, 1)
  })

  await t.test('clearing the login forgets the refusal', async () => {
    stub(() => json(401))
    const oauth = expiredLogin()
    await oauth.getValidAccessToken()
    assert.equal(oauth.needsReauthorization(), true)

    oauth.clearTokenData()

    assert.equal(oauth.needsReauthorization(), false)
  })
})

test('revokeTokens()', async (t) => {
  await t.test('asks Twitch to forget both the access token and the refresh token', async () => {
    stub(() => json(200))
    await expiredLogin().revokeTokens()

    assert.equal(sent.length, 2)
    assert.ok(sent.every((request) => request.url === 'https://id.twitch.tv/oauth2/revoke'))
    assert.deepEqual(sent.map((request) => request.body.get('token')).sort(), ['old-access', 'old-refresh'])
    assert.ok(sent.every((request) => request.body.get('client_id') === 'client-1'))
  })

  await t.test('a refusal or a lost connection does not stop the disconnect', async () => {
    stub(() => new TypeError('fetch failed'))
    await assert.doesNotReject(expiredLogin().revokeTokens())

    stub(() => json(400))
    await assert.doesNotReject(expiredLogin().revokeTokens())
  })

  await t.test('without a login nothing is sent', async () => {
    stub(() => json(200))
    await new TwitchOAuth({ clientId: 'client-1' }).revokeTokens()
    assert.equal(sent.length, 0)
  })
})
