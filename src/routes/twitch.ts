import express from 'express'
import { ok, failFromError, asyncHandler } from '../http.js'
import type { TwitchConnectionResponse } from '../types.js'
import { AppError } from '../types.js'
import { getConnectionStatus, startDeviceAuthorization, disconnect, refreshConnection, getClient } from '../integrations/twitch/index.js'

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

router.post(
  '/connect',
  asyncHandler(async (_req, res) => {
    const device = await startDeviceAuthorization()

    ok(res, {
      userCode: device.user_code,
      verificationUri: device.verification_uri,
      expiresIn: device.expires_in
    })
  })
)

router.post(
  '/disconnect',
  asyncHandler(async (_req, res) => {
    await disconnect()
    ok(res, {})
  })
)

router.post(
  '/refresh',
  asyncHandler(async (_req, res) => {
    const userInfo = await refreshConnection()

    ok(res, {
      user: toUserResponse(userInfo)
    })
  })
)

router.get(
  '/rewards',
  asyncHandler(async (_req, res) => {
    const client = getClient()

    if (!client || !getConnectionStatus().connected) {
      throw new AppError('TWITCH_NOT_CONNECTED', 'Twitch account is not connected')
    }

    const rewards = await client.getCustomRewards()

    ok(res, {
      rewards: rewards.filter((reward) => reward.is_enabled && reward.is_user_input_required)
    })
  })
)
