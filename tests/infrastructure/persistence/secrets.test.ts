import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TwitchTokenData, TwitchUserInfo } from '../../../src/integrations/twitch/types.js'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const { getSecrets, updateSecrets, getPublicSecretsView } = await import('../../../src/infrastructure/persistence/secrets.js')

beforeEach(() => {
  updateSecrets({ youtubeApiKey: ' ' }) // reset: a whitespace-only value is ignored, see below
  updateSecrets({ twitchTokenData: null, twitchUserInfo: null, twitchConnectedAt: null })
})

test('updateSecrets()', async (t) => {
  await t.test('sets the key, trimmed', () => {
    updateSecrets({ youtubeApiKey: '  my-api-key-123  ' })
    assert.equal(getSecrets().youtubeApiKey, 'my-api-key-123')
  })

  await t.test('an empty or whitespace-only value is ignored, keeping the previous key', () => {
    updateSecrets({ youtubeApiKey: 'first-key' })

    updateSecrets({ youtubeApiKey: '' })
    assert.equal(getSecrets().youtubeApiKey, 'first-key')

    updateSecrets({ youtubeApiKey: '   ' })
    assert.equal(getSecrets().youtubeApiKey, 'first-key')
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
    updateSecrets({ twitchTokenData: tokenData })
    assert.equal(getSecrets().twitchTokenData?.accessToken, 'test_access_token')
  })

  await t.test('can update Twitch user info', () => {
    const userInfo: TwitchUserInfo = {
      id: '12345',
      login: 'testuser',
      displayName: 'TestUser',
      profileImageUrl: 'https://example.com/avatar.jpg'
    }
    updateSecrets({ twitchUserInfo: userInfo })
    assert.equal(getSecrets().twitchUserInfo?.displayName, 'TestUser')
  })

  await t.test('can update Twitch connection timestamp', () => {
    const timestamp = Date.now()
    updateSecrets({ twitchConnectedAt: timestamp })
    assert.equal(getSecrets().twitchConnectedAt, timestamp)
  })

  await t.test('returns the resulting secrets', () => {
    const result = updateSecrets({ youtubeApiKey: 'the-key' })
    assert.equal(result.youtubeApiKey, 'the-key')
    assert.equal(result.twitchTokenData, null)
    assert.equal(result.twitchUserInfo, null)
    assert.equal(result.twitchConnectedAt, null)
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
  // updateSecrets() never accepts an empty value (see above), so a truly empty key can only be observed on
  // a fresh store that has never had one set - load it from a location no earlier test has written to
  const emptyDir = mkdtempSync(join(tmpdir(), 'streamqueue-test-empty-'))
  const cwd = process.cwd()
  process.chdir(emptyDir)
  const fresh = await import(`../../../src/infrastructure/persistence/secrets.js?fresh=${Date.now()}`)
  process.chdir(cwd)

  await t.test('masked value is empty and hasYoutubeApiKey is false', () => {
    const view = fresh.getPublicSecretsView()
    assert.equal(view.youtubeApiKey, '')
    assert.equal(view.hasYoutubeApiKey, false)
    assert.equal(view.twitchConnected, false)
    assert.equal(view.twitchUser, null)
  })
})

test('getPublicSecretsView()', async (t) => {

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
    assert.equal(view.twitchConnected, false)
    assert.equal(view.twitchUser, null)
  })

  await t.test('twitchConnected reflects Twitch connection status', () => {
    updateSecrets({ youtubeApiKey: 'x'.repeat(20) })
    assert.equal(getPublicSecretsView().twitchConnected, false)

    const tokenData: TwitchTokenData = {
      accessToken: 'test_access_token',
      refreshToken: 'test_refresh_token',
      expiresAt: Date.now() + 3600000,
      scope: ['channel:read:subscriptions']
    }
    updateSecrets({ twitchTokenData: tokenData })
    assert.equal(getPublicSecretsView().twitchConnected, true)
  })

  await t.test('twitchUser reflects connected Twitch user info', () => {
    updateSecrets({ youtubeApiKey: 'x'.repeat(20) })
    assert.equal(getPublicSecretsView().twitchUser, null)

    const userInfo: TwitchUserInfo = {
      id: '12345',
      login: 'testuser',
      displayName: 'TestUser',
      profileImageUrl: 'https://example.com/avatar.jpg'
    }
    updateSecrets({ twitchUserInfo: userInfo })
    const view = getPublicSecretsView()
    assert.equal(view.twitchUser?.displayName, 'TestUser')
    assert.equal(view.twitchUser?.login, 'testuser')
  })
})
