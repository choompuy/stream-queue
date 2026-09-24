import express from 'express'
import { ok, fail, asyncHandler } from '../router.js'
import type { TwitchConnectionResponse, TwitchAuthResponse, TwitchCallbackResponse } from '../../shared/types.js'
import {
  getConnectionStatus,
  getAuthUrl,
  handleOAuthCallback,
  disconnect,
  refreshConnection
} from '../../integrations/twitch/index.js'

function log(message: string): void {
  console.log(`[TWITCH ROUTES] ${message}`)
}

export const router = express.Router()

router.get('/', (_req, res) => {
  const status = getConnectionStatus()
  
  const response: TwitchConnectionResponse = {
    connected: status.connected,
    user: status.user ? { displayName: status.user.displayName, login: status.user.login } : null,
    connectedAt: status.connectedAt
  }
  
  ok(res, response)
})

router.get('/auth', (req, res) => {
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
    const { code, error, error_description } = req.query

    if (error) {
      fail(
        res,
        error_description as string || 'OAuth authorization failed',
        'TWITCH_OAUTH_ERROR',
        400
      )
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
  disconnect()
  ok(res, { success: true })
})

router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
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