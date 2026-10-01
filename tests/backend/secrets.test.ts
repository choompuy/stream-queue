import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TwitchTokenData, TwitchUserInfo } from '../../src/integrations/twitch/types.js'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const { getSecrets, updateSecrets, updateTwitchOAuthState, clearTwitchOAuthState, getPublicSecretsView, getTwitchClientId } =
  await import('../../src/secrets.js')

beforeEach(() => {
  updateSecrets({ youtubeApiKey: ' ' }) // reset: a whitespace-only value is ignored, see below
  updateTwitchOAuthState({ tokenData: null, userInfo: null, connectedAt: null })
})

afterEach(() => {
  delete process.env.TWITCH_CLIENT_ID
})

test('updateSecrets()', async (t) => {
  await t.test('sets the key, trimmed', () => {
    updateSecrets({ youtubeApiKey: '  my-api-key-123  ' })
    assert.equal(getSecrets().youtubeApiKey, 'my-api-key-123')
  })

  await t.test('an empty or whitespace-only value is reset to empty', () => {
    updateSecrets({ youtubeApiKey: 'first-key' })

    updateSecrets({ youtubeApiKey: '' })
    assert.equal(getSecrets().youtubeApiKey, '')

    updateSecrets({ youtubeApiKey: 'second-key' })
    updateSecrets({ youtubeApiKey: '   ' })
    assert.equal(getSecrets().youtubeApiKey, '')
  })

  await t.test('an update with no youtubeApiKey field leaves the key untouched', () => {
    updateSecrets({ youtubeApiKey: 'kept-key' })
    updateSecrets({})
    assert.equal(getSecrets().youtubeApiKey, 'kept-key')
  })

  await t.test('can update Twitch token data', () => {
    const tokenData: TwitchTokenData = {
      accessToken: 'test_access_token',
      refreshToken: 'test_refresh_token',
      expiresAt: Date.now() + 3600000,
      scope: ['channel:read:subscriptions']
    }
    updateTwitchOAuthState({ tokenData })
    assert.equal(getSecrets().twitch.tokenData?.accessToken, 'test_access_token')
  })

  await t.test('can update Twitch user info', () => {
    const userInfo: TwitchUserInfo = {
      id: '12345',
      login: 'testuser',
      displayName: 'TestUser',
      profileImageUrl: 'https://example.com/avatar.jpg'
    }
    updateTwitchOAuthState({ userInfo })
    assert.equal(getSecrets().twitch.userInfo?.displayName, 'TestUser')
  })

  await t.test('can update Twitch connection timestamp', () => {
    const timestamp = Date.now()
    updateTwitchOAuthState({ connectedAt: timestamp })
    assert.equal(getSecrets().twitch.connectedAt, timestamp)
  })

  await t.test('returns the resulting secrets', () => {
    const result = updateSecrets({ youtubeApiKey: 'the-key' })
    assert.equal(result.youtubeApiKey, 'the-key')
    assert.equal(result.twitch.tokenData, null)
    assert.equal(result.twitch.userInfo, null)
    assert.equal(result.twitch.connectedAt, null)
  })
})

test('updateTwitchOAuthState() validation', async (t) => {
  await t.test('rejects malformed tokenData and leaves the stored value untouched', () => {
    assert.throws(() => updateTwitchOAuthState({ tokenData: { accessToken: 'only-this-field' } as unknown as TwitchTokenData }))
    assert.equal(getSecrets().twitch.tokenData, null)
  })

  await t.test('rejects tokenData with a non-string scope entry', () => {
    const bad = {
      accessToken: 'a',
      refreshToken: 'b',
      expiresAt: Date.now(),
      scope: ['ok', 123]
    } as unknown as TwitchTokenData
    assert.throws(() => updateTwitchOAuthState({ tokenData: bad }))
  })

  await t.test('rejects malformed userInfo and leaves the stored value untouched', () => {
    assert.throws(() => updateTwitchOAuthState({ userInfo: { id: '1' } as unknown as TwitchUserInfo }))
    assert.equal(getSecrets().twitch.userInfo, null)
  })

  await t.test('rejects a non-number connectedAt', () => {
    assert.throws(() => updateTwitchOAuthState({ connectedAt: 'yesterday' as unknown as number }))
  })

  await t.test('accepts explicit null for tokenData, userInfo and connectedAt', () => {
    const tokenData: TwitchTokenData = {
      accessToken: 'a',
      refreshToken: 'b',
      expiresAt: Date.now(),
      scope: []
    }
    updateTwitchOAuthState({ tokenData })
    assert.doesNotThrow(() => updateTwitchOAuthState({ tokenData: null, userInfo: null, connectedAt: null }))
    assert.equal(getSecrets().twitch.tokenData, null)
  })

  await t.test('a valid update still applies', () => {
    const userInfo: TwitchUserInfo = {
      id: '1',
      login: 'user',
      displayName: 'User',
      profileImageUrl: 'https://example.com/a.jpg'
    }
    updateTwitchOAuthState({ userInfo })
    assert.equal(getSecrets().twitch.userInfo?.login, 'user')
  })
})

test('clearTwitchOAuthState()', async (t) => {
  await t.test('is a no-op (does not throw, state stays empty) when already empty', () => {
    assert.equal(getSecrets().twitch.tokenData, null)
    assert.doesNotThrow(() => clearTwitchOAuthState())
    assert.equal(getSecrets().twitch.tokenData, null)
  })

  await t.test('clears a previously set state', () => {
    const userInfo: TwitchUserInfo = {
      id: '1',
      login: 'user',
      displayName: 'User',
      profileImageUrl: 'https://example.com/a.jpg'
    }
    updateTwitchOAuthState({ userInfo, connectedAt: Date.now() })

    clearTwitchOAuthState()

    assert.equal(getSecrets().twitch.userInfo, null)
    assert.equal(getSecrets().twitch.connectedAt, null)
  })
})

test('getSecrets()', async (t) => {
  await t.test('returns a copy: mutating the result does not change the stored secrets', () => {
    updateSecrets({ youtubeApiKey: 'original' })
    const secrets = getSecrets()
    secrets.youtubeApiKey = 'tampered'

    assert.equal(getSecrets().youtubeApiKey, 'original')
  })
})

test('getPublicSecretsView() with no key set', async (t) => {
  await t.test('masked value is empty and hasYoutubeApiKey is false', () => {
    process.env.TWITCH_CLIENT_ID = 'test_client_id'
    // Ensure the current instance has an empty key (it should already be empty from beforeEach)
    const view = getPublicSecretsView()
    assert.equal(view.youtubeApiKey, '')
    assert.equal(view.hasYoutubeApiKey, false)
    assert.equal(view.twitch.connected, false)
    assert.equal(view.twitch.user, null)
  })
})

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

test('getPublicSecretsView() reflects an unset TWITCH_CLIENT_ID without throwing', async (t) => {
  await t.test('twitch.configured is false and the call does not throw', () => {
    delete process.env.TWITCH_CLIENT_ID
    assert.doesNotThrow(() => getPublicSecretsView())
    assert.equal(getPublicSecretsView().twitch.configured, false)
  })
})

test('getPublicSecretsView()', async (t) => {
  t.beforeEach(() => {
    process.env.TWITCH_CLIENT_ID = 'test_client_id'
  })

  await t.test('a short key (8 chars or fewer) is fully masked, same length as the original', () => {
    updateSecrets({ youtubeApiKey: 'abcd1234' }) // exactly 8
    const view = getPublicSecretsView()

    assert.equal(view.youtubeApiKey, '•'.repeat(8))
    assert.equal(view.hasYoutubeApiKey, true)
  })

  await t.test('a key of 7 chars (just under the boundary) is also fully masked', () => {
    updateSecrets({ youtubeApiKey: 'abcd123' })
    assert.equal(getPublicSecretsView().youtubeApiKey, '•'.repeat(7))
  })

  await t.test('a key of 9 chars (just over the boundary) shows first 4 and last 4, masking the middle', () => {
    updateSecrets({ youtubeApiKey: 'abcd12345' })
    assert.equal(getPublicSecretsView().youtubeApiKey, 'abcd•2345')
  })

  await t.test('a long, realistic-looking key never exposes more than its first and last 4 characters', () => {
    const key = 'AIzaSyD-9tSrke72PouQMnMX-a7eZSW0jkFMBc'
    updateSecrets({ youtubeApiKey: key })
    const view = getPublicSecretsView()

    assert.equal(view.youtubeApiKey.startsWith(key.slice(0, 4)), true)
    assert.equal(view.youtubeApiKey.endsWith(key.slice(-4)), true)
    assert.equal(view.youtubeApiKey.slice(4, -4), '•'.repeat(key.length - 8))
    assert.equal(view.youtubeApiKey.includes(key.slice(4, -4)), false, 'no middle segment of the real key should leak through')
  })

  await t.test('hasYoutubeApiKey reflects whether a key is set, independent of masking', () => {
    updateSecrets({ youtubeApiKey: 'x'.repeat(20) })
    const view = getPublicSecretsView()
    assert.equal(view.hasYoutubeApiKey, true)
    assert.equal(view.twitch.connected, false)
    assert.equal(view.twitch.user, null)
  })

  await t.test('twitchConnected reflects Twitch connection status', () => {
    updateSecrets({ youtubeApiKey: 'x'.repeat(20) })
    assert.equal(getPublicSecretsView().twitch.connected, false)

    const tokenData: TwitchTokenData = {
      accessToken: 'test_access_token',
      refreshToken: 'test_refresh_token',
      expiresAt: Date.now() + 3600000,
      scope: ['channel:read:subscriptions']
    }
    updateTwitchOAuthState({ tokenData })
    assert.equal(getPublicSecretsView().twitch.connected, false) // Still false without userInfo
  })

  await t.test('twitchConnected is true when both tokenData and userInfo are present', () => {
    updateSecrets({ youtubeApiKey: 'x'.repeat(20) })
    assert.equal(getPublicSecretsView().twitch.connected, false)

    const tokenData: TwitchTokenData = {
      accessToken: 'test_access_token',
      refreshToken: 'test_refresh_token',
      expiresAt: Date.now() + 3600000,
      scope: ['channel:read:subscriptions']
    }
    const userInfo: TwitchUserInfo = {
      id: '12345',
      login: 'testuser',
      displayName: 'TestUser',
      profileImageUrl: 'https://example.com/avatar.jpg'
    }
    updateTwitchOAuthState({ tokenData, userInfo })
    assert.equal(getPublicSecretsView().twitch.connected, true)
  })

  await t.test('twitchUser reflects connected Twitch user info', () => {
    updateSecrets({ youtubeApiKey: 'x'.repeat(20) })
    assert.equal(getPublicSecretsView().twitch.user, null)

    const userInfo: TwitchUserInfo = {
      id: '12345',
      login: 'testuser',
      displayName: 'TestUser',
      profileImageUrl: 'https://example.com/avatar.jpg'
    }
    updateTwitchOAuthState({ userInfo })
    const view = getPublicSecretsView()
    assert.equal(view.twitch.user?.displayName, 'TestUser')
    assert.equal(view.twitch.user?.login, 'testuser')
  })
})
