import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TwitchOAuth } from '../../../../src/integrations/twitch/oauth.js'
import {
  initializeTwitchIntegration,
  getConnectionStatus,
  disconnect,
  getAuthUrl,
  _resetIntegration
} from '../../../../src/integrations/twitch/index.js'
import type { TwitchTokenData } from '../../../../src/integrations/twitch/types.js'

test('TwitchOAuth', async (t) => {
  await t.test('getAuthUrl throws error when client ID not configured', () => {
    const oauth = new TwitchOAuth({ clientId: '' })
    assert.throws(() => oauth.getAuthUrl(), /Twitch client ID not configured/)
  })

  await t.test('getAuthUrl returns valid URL when configured', () => {
    const oauth = new TwitchOAuth({
      clientId: 'test_client_id',
      redirectUri: 'http://localhost:3000/api/integrations/twitch/callback'
    })
    const authUrl = oauth.getAuthUrl()

    assert.ok(authUrl.startsWith('https://id.twitch.tv/oauth2/authorize'))
    assert.ok(authUrl.includes('client_id=test_client_id'))
    assert.ok(authUrl.includes('redirect_uri='))
    assert.ok(authUrl.includes('response_type=code'))
    assert.ok(authUrl.includes('scope='))
  })

  await t.test('setTokenData and getTokenData work correctly', () => {
    const oauth = new TwitchOAuth()
    const tokenData: TwitchTokenData = {
      accessToken: 'test_access_token',
      refreshToken: 'test_refresh_token',
      expiresAt: Date.now() + 3600000,
      scope: ['channel:read:subscriptions']
    }

    oauth.setTokenData(tokenData)
    const retrieved = oauth.getTokenData()

    assert.equal(retrieved?.accessToken, tokenData.accessToken)
    assert.equal(retrieved?.refreshToken, tokenData.refreshToken)
    assert.equal(retrieved?.expiresAt, tokenData.expiresAt)
    assert.deepEqual(retrieved?.scope, tokenData.scope)
  })

  await t.test('clearTokenData removes token data', () => {
    const oauth = new TwitchOAuth()
    const tokenData: TwitchTokenData = {
      accessToken: 'test_access_token',
      refreshToken: 'test_refresh_token',
      expiresAt: Date.now() + 3600000,
      scope: ['channel:read:subscriptions']
    }

    oauth.setTokenData(tokenData)
    assert.ok(oauth.getTokenData())

    oauth.clearTokenData()
    assert.equal(oauth.getTokenData(), null)
  })

  await t.test('isAuthenticated returns false when no token', () => {
    const oauth = new TwitchOAuth()
    assert.equal(oauth.isAuthenticated(), false)
  })

  await t.test('isAuthenticated returns true when valid token exists', () => {
    const oauth = new TwitchOAuth()
    const tokenData: TwitchTokenData = {
      accessToken: 'test_access_token',
      refreshToken: 'test_refresh_token',
      expiresAt: Date.now() + 3600000,
      scope: ['channel:read:subscriptions']
    }

    oauth.setTokenData(tokenData)
    assert.equal(oauth.isAuthenticated(), true)
  })

  await t.test('isAuthenticated returns false when token expired', () => {
    const oauth = new TwitchOAuth()
    const tokenData: TwitchTokenData = {
      accessToken: 'test_access_token',
      refreshToken: 'test_refresh_token',
      expiresAt: Date.now() - 1000, // Expired
      scope: ['channel:read:subscriptions']
    }

    oauth.setTokenData(tokenData)
    assert.equal(oauth.isAuthenticated(), false)
  })

  await t.test('needsRefresh returns true when token near expiration', () => {
    const oauth = new TwitchOAuth()
    const tokenData: TwitchTokenData = {
      accessToken: 'test_access_token',
      refreshToken: 'test_refresh_token',
      expiresAt: Date.now() + 4 * 60 * 1000, // 4 minutes from now (within 5 min buffer)
      scope: ['channel:read:subscriptions']
    }

    oauth.setTokenData(tokenData)
    assert.equal(oauth.needsRefresh(), true)
  })

  await t.test('needsRefresh returns false when token is fresh', () => {
    const oauth = new TwitchOAuth()
    const tokenData: TwitchTokenData = {
      accessToken: 'test_access_token',
      refreshToken: 'test_refresh_token',
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes from now
      scope: ['channel:read:subscriptions']
    }

    oauth.setTokenData(tokenData)
    assert.equal(oauth.needsRefresh(), false)
  })
})

test('TwitchIntegration', async (t) => {
  await t.test('getAuthUrl throws error when not initialized', () => {
    _resetIntegration()

    assert.throws(() => getAuthUrl(), /Twitch integration not initialized/)
  })

  await t.test('getAuthUrl returns valid URL when initialized', () => {
    _resetIntegration()
    initializeTwitchIntegration({
      clientId: 'test_client_id',
      clientSecret: 'test_client_secret'
    })

    const authUrl = getAuthUrl()

    assert.ok(authUrl.startsWith('https://id.twitch.tv/oauth2/authorize'))
    assert.ok(authUrl.includes('client_id=test_client_id'))
  })

  await t.test('getConnectionStatus returns disconnected when no token', () => {
    _resetIntegration()
    initializeTwitchIntegration({
      clientId: 'test_client_id',
      clientSecret: 'test_client_secret'
    })

    const status = getConnectionStatus()

    assert.equal(status.connected, false)
    assert.equal(status.user, null)
    assert.equal(status.connectedAt, null)
  })

  await t.test('disconnect works without errors', () => {
    _resetIntegration()
    initializeTwitchIntegration({
      clientId: 'test_client_id',
      clientSecret: 'test_client_secret'
    })

    // Should not throw any errors
    disconnect()

    const status = getConnectionStatus()
    assert.equal(status.connected, false)
  })

  await t.test('initializeTwitchIntegration can be called multiple times safely', () => {
    _resetIntegration()
    initializeTwitchIntegration({
      clientId: 'test_client_id',
      clientSecret: 'test_client_secret'
    })

    initializeTwitchIntegration({
      clientId: 'test_client_id',
      clientSecret: 'test_client_secret'
    })

    // Should not throw any errors
    const authUrl = getAuthUrl()
    assert.ok(authUrl.startsWith('https://id.twitch.tv/oauth2/authorize'))
  })
})
