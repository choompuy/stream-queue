import express from 'express'
import { ok, fail, asyncHandler } from '../http.js'
import type { TwitchConfig, TwitchConnectionResponse } from '../integrations/twitch/types.js'
import { AppError, type ConfigUpdateResponse } from '../types.js'
import { startDeviceAuthorization, disconnect, refreshConnection, getClient } from '../integrations/twitch/index.js'
import { getTwitchConfig, updateTwitchConfig } from '../integrations/twitch/config.js'
import { localOnly } from '../local-only.js'
import { getPublicSecretsView } from '../secrets.js'

function toUserResponse(user: { displayName: string; login: string }) {
  return {
    displayName: user.displayName,
    login: user.login
  }
}

export const router = express.Router()

router.get('/', (_req, res) => {
  ok<TwitchConnectionResponse>(res, getPublicSecretsView().twitch)
})

router.get('/config', (_req, res) => {
  const twitchConfig = getTwitchConfig()
  const response = {
    channelPointsRewardId: twitchConfig.channelPointsRewardId,
    chatCommands: twitchConfig.chatCommands
  }
  ok(res, response)
})

router.put(
  '/config',
  localOnly,
  asyncHandler(async (req, res) => {
    const { config, rejected } = updateTwitchConfig(req.body)

    const response: ConfigUpdateResponse<TwitchConfig> = {
      config: { channelPointsRewardId: config.channelPointsRewardId, chatCommands: config.chatCommands },
      rejected
    }

    if (rejected.length) {
      fail(res, 'invalid config fields', 'INVALID_CONFIG', 400, { fields: rejected.join(', ') })
    }

    ok(res, response)
  })
)

router.post(
  '/connect',
  localOnly,
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
  localOnly,
  asyncHandler(async (_req, res) => {
    await disconnect()
    ok(res, {})
  })
)

router.post(
  '/refresh',
  localOnly,
  asyncHandler(async (_req, res) => {
    const userInfo = await refreshConnection()

    ok(res, {
      user: toUserResponse(userInfo)
    })
  })
)

router.get(
  '/rewards',
  localOnly,
  asyncHandler(async (_req, res) => {
    const client = getClient()

    if (!client || !getPublicSecretsView().twitch.connected) {
      throw new AppError('TWITCH_NOT_CONNECTED', 'Twitch account is not connected')
    }

    const rewards = await client.getCustomRewards()

    ok(res, {
      rewards: rewards.filter((reward) => reward.is_enabled && reward.is_user_input_required)
    })
  })
)
