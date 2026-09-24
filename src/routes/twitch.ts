import express from 'express'
import { ok, fail, asyncHandler } from '../http.js'
import type { TwitchConnectionResponse, TwitchAuthResponse, TwitchCallbackResponse } from '../types.js'
import { initializeTwitchIntegration, getConnectionStatus, getAuthUrl, handleOAuthCallback, disconnect, refreshConnection } from '../integrations/twitch/index.js'

function log(message: string): void {
  console.log(`[TWITCH ROUTES] ${message}`)
}

export const router = express.Router()

let initialized = false

function ensureInitialized(): void {
  if (!initialized) {
    initializeTwitchIntegration()
    initialized = true
    log('Twitch integration initialized')
  }
}

router.get('/', (_req, res) => {
  ensureInitialized()
  const status = getConnectionStatus()

  const response: TwitchConnectionResponse = {
    connected: status.connected,
    user: status.user ? { displayName: status.user.displayName, login: status.user.login } : null,
    connectedAt: status.connectedAt
  }

  ok(res, response)
})

router.get('/auth', (req, res) => {
  ensureInitialized()
  try {
    const authUrl = getAuthUrl()
    const response: TwitchAuthResponse = { authUrl }
    ok(res, response)
  } catch (error) {
    fail(res, 'Failed to generate auth URL', 'TWITCH_AUTH_ERROR', 500)
  }
})

router.get(
  '/callback',
  asyncHandler(async (req, res) => {
    ensureInitialized()
    const { code, error, error_description } = req.query

    if (error) {
      fail(res, (error_description as string) || 'OAuth authorization failed', 'TWITCH_OAUTH_ERROR', 400)
      return
    }

    if (!code || typeof code !== 'string') {
      fail(res, 'Missing authorization code', 'TWITCH_OAUTH_ERROR', 400)
      return
    }

    try {
      const userInfo = await handleOAuthCallback(code)
      const response: TwitchCallbackResponse = {
        success: true,
        user: { displayName: userInfo.displayName, login: userInfo.login }
      }
      ok(res, response)
    } catch (error) {
      fail(res, 'Failed to complete OAuth flow', 'TWITCH_OAUTH_ERROR', 500)
    }
  })
)

router.post('/disconnect', (_req, res) => {
  ensureInitialized()
  disconnect()
  ok(res, { success: true })
})

router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    ensureInitialized()
    try {
      const userInfo = await refreshConnection()
      const response: TwitchCallbackResponse = {
        success: true,
        user: { displayName: userInfo.displayName, login: userInfo.login }
      }
      ok(res, response)
    } catch (error) {
      fail(res, 'Failed to refresh connection', 'TWITCH_REFRESH_ERROR', 500)
    }
  })
)
