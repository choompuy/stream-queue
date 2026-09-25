import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TwitchOAuth } from '../../../../src/integrations/twitch/oauth.js'
import {
  initializeTwitchIntegration,
  getConnectionStatus,
  disconnect,
  startDeviceAuthorization,
  isDeviceAuthorizationPending,
  _resetIntegration
} from '../../../../src/integrations/twitch/index.js'
import type { TwitchTokenData } from '../../../../src/integrations/twitch/types.js'

test('TwitchOAuth', async (t) => {
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

  await t.test('isAuthenticated returns true when token has refresh token (even if expired)', () => {
    const oauth = new TwitchOAuth()
    const tokenData: TwitchTokenData = {
      accessToken: 'test_access_token',
      refreshToken: 'test_refresh_token',
      expiresAt: Date.now() - 1000, // Expired
      scope: ['channel:read:subscriptions']
    }

    oauth.setTokenData(tokenData)
    assert.equal(oauth.isAuthenticated(), true) // Changed: it should be true if refresh token exists
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
  t.beforeEach(async () => {
    await _resetIntegration()
  })

  await t.test('getConnectionStatus returns disconnected when not initialized', () => {
    const status = getConnectionStatus()

    assert.equal(status.connected, false)
    assert.equal(status.user, null)
    assert.equal(status.connectedAt, null)
  })

  await t.test('getConnectionStatus returns disconnected when initialized but no token', () => {
    initializeTwitchIntegration({
      clientId: 'test_client_id'
    })

    const status = getConnectionStatus()

    assert.equal(status.connected, false)
    assert.equal(status.user, null)
    assert.equal(status.connectedAt, null)
  })

  await t.test('disconnect works without errors', async () => {
    initializeTwitchIntegration({
      clientId: 'test_client_id'
    })

    // Should not throw any errors
    await disconnect()

    const status = getConnectionStatus()
    assert.equal(status.connected, false)
  })

  await t.test('initializeTwitchIntegration can be called multiple times safely', () => {
    initializeTwitchIntegration({
      clientId: 'test_client_id'
    })

    initializeTwitchIntegration({
      clientId: 'test_client_id'
    })

    // Should not throw any errors
    const status = getConnectionStatus()
    assert.equal(status.connected, false)
  })

  await t.test('isDeviceAuthorizationPending returns false when no authorization in progress', () => {
    initializeTwitchIntegration({
      clientId: 'test_client_id'
    })

    assert.equal(isDeviceAuthorizationPending(), false)
  })
})
