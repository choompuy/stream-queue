import crypto from 'node:crypto'
import express from 'express'
import { ok, fail, asyncHandler } from '../http.js'
import type { TwitchConnectionResponse, TwitchAuthResponse, TwitchCallbackResponse } from '../types.js'
import { getConnectionStatus, getAuthUrl, handleOAuthCallback, disconnect, refreshConnection } from '../integrations/twitch/index.js'

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000
const MAX_OAUTH_STATES = 100

const oauthStates = new Map<string, number>()

function cleanupExpiredStates(): void {
  const now = Date.now()

  for (const [state, expiresAt] of oauthStates) {
    if (expiresAt <= now) oauthStates.delete(state)
  }
}

function createOAuthState(): string {
  cleanupExpiredStates()

  if (oauthStates.size >= MAX_OAUTH_STATES) {
    const oldestState = oauthStates.keys().next().value
    if (oldestState) oauthStates.delete(oldestState)
  }

  const state = crypto.randomBytes(32).toString('hex')
  oauthStates.set(state, Date.now() + OAUTH_STATE_TTL_MS)
  return state
}

function consumeOAuthState(state: string): boolean {
  cleanupExpiredStates()

  const expiresAt = oauthStates.get(state)
  if (!expiresAt) return false

  oauthStates.delete(state)
  return expiresAt > Date.now()
}

function toUserResponse(user: { displayName: string; login: string }) {
  return {
    displayName: user.displayName,
    login: user.login
  }
}

export const router = express.Router()

router.get('/', (_req, res) => {
  const status = getConnectionStatus()
  const response: TwitchConnectionResponse = {
    connected: status.connected,
    user: status.user ? toUserResponse(status.user) : null,
    connectedAt: status.connectedAt
  }
  ok(res, response)
})

router.get('/auth', (_req, res) => {
  try {
    const state = createOAuthState()
    const authUrl = getAuthUrl(state)
    const response: TwitchAuthResponse = {
      authUrl
    }
    ok(res, response)
  } catch (error) {
    console.error('[TWITCH ROUTES] Failed to generate auth URL:', error instanceof Error ? error.message : error)
    fail(res, 'Failed to generate Twitch authorization URL', 'TWITCH_AUTH_ERROR', 500)
  }
})

router.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query

  if (error) {
    if (typeof state === 'string') consumeOAuthState(state)
    fail(res, typeof error_description === 'string' ? error_description : 'OAuth authorization failed', 'TWITCH_OAUTH_ERROR', 400)
    return
  }

  if (typeof state !== 'string') {
    fail(res, 'Missing OAuth state', 'TWITCH_OAUTH_ERROR', 400)
    return
  }

  if (!consumeOAuthState(state)) {
    fail(res, 'Invalid or expired OAuth state', 'TWITCH_OAUTH_ERROR', 400)
    return
  }

  if (typeof code !== 'string') {
    fail(res, 'Missing authorization code', 'TWITCH_OAUTH_ERROR', 400)
    return
  }

  try {
    const userInfo = await handleOAuthCallback(code)
    const response: TwitchCallbackResponse = {
      success: true,
      user: toUserResponse(userInfo)
    }
    ok(res, response)
  } catch (error) {
    console.error('[TWITCH ROUTES] OAuth callback failed:', error instanceof Error ? error.message : error)
    fail(res, 'Failed to complete Twitch authorization', 'TWITCH_OAUTH_ERROR', 500)
  }
})

router.post(
  '/disconnect',
  asyncHandler(async (_req, res) => {
    await disconnect()
    ok(res, { success: true })
  })
)

router.post('/refresh', async (_req, res) => {
  try {
    const userInfo = await refreshConnection()
    const response: TwitchCallbackResponse = {
      success: true,
      user: toUserResponse(userInfo)
    }
    ok(res, response)
  } catch (error) {
    console.error('[TWITCH ROUTES] Failed to refresh connection:', error instanceof Error ? error.message : error)
    fail(res, 'Failed to refresh Twitch connection', 'TWITCH_REFRESH_ERROR', 500)
  }
})
