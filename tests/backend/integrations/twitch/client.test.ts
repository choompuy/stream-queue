import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { TwitchOAuth } from '../../../../src/integrations/twitch/oauth.js'
import { TwitchClient } from '../../../../src/integrations/twitch/client.js'

const realFetch = globalThis.fetch
after(() => {
  globalThis.fetch = realFetch
})

const USER = { data: [{ id: '1', login: 'streamer', display_name: 'Streamer', profile_image_url: 'https://img/1.png' }] }
const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

let helix: string[] = [] // the access token each Helix request went out with
let refreshes = 0

// `helixAnswers` are used in order for Helix, `refresh` answers the token endpoint
function stub(helixAnswers: Response[], refresh: () => Response): void {
  helix = []
  refreshes = 0

  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input)

    if (url.startsWith('https://id.twitch.tv/oauth2/token')) {
      refreshes++
      return refresh()
    }

    helix.push(new Headers(init?.headers).get('Authorization') ?? '')
    return helixAnswers[Math.min(helix.length - 1, helixAnswers.length - 1)]
  }
}

const refreshed = () => json(200, { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, scope: [], token_type: 'bearer' })

function connectedClient(): TwitchClient {
  const oauth = new TwitchOAuth({ clientId: 'client-1' })
  oauth.setTokenData({ accessToken: 'live-access', refreshToken: 'live-refresh', expiresAt: Date.now() + 3_600_000, scope: [] })
  return new TwitchClient(oauth)
}

beforeEach(() => {
  helix = []
  refreshes = 0
})

test('TwitchClient authenticated requests', async (t) => {
  await t.test('a 403 is reported as it is: no token refresh, no "reconnect" advice', async () => {
    stub([json(403, { message: 'The ID in broadcaster_id must match the user ID found in the request' })], refreshed)

    await assert.rejects(connectedClient().getUserInfo(), (error: { code?: string }) => error.code === 'TWITCH_API_ERROR')
    assert.equal(refreshes, 0)
    assert.equal(helix.length, 1)
  })

  await t.test('a 401 refreshes the token once and repeats the request with the new one', async () => {
    stub([json(401), json(200, USER)], refreshed)

    const user = await connectedClient().getUserInfo()

    assert.equal(user.displayName, 'Streamer')
    assert.equal(refreshes, 1)
    assert.deepEqual(helix, ['Bearer live-access', 'Bearer new-access'])
  })

  await t.test('an error of the repeated request is its own error, not a failed login', async () => {
    stub([json(401), json(403, { message: 'not yours' })], refreshed)

    await assert.rejects(connectedClient().getUserInfo(), (error: { code?: string }) => error.code === 'TWITCH_API_ERROR')
  })

  await t.test('a 401 whose refresh is refused asks to reconnect', async () => {
    stub([json(401)], () => json(400, { message: 'Invalid refresh token' }))

    await assert.rejects(connectedClient().getUserInfo(), (error: { code?: string }) => error.code === 'TWITCH_REFRESH_ERROR')
    assert.equal(helix.length, 1, 'the request is not repeated without a new token')
  })

  await t.test('needsReauthorization() follows the login', async () => {
    stub([json(401)], () => json(400))
    const client = connectedClient()

    assert.equal(client.needsReauthorization(), false)
    await assert.rejects(client.getUserInfo())
    assert.equal(client.needsReauthorization(), true)
  })
})
