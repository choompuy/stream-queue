import express from 'express'
import { ok, asyncHandler, sendConfigUpdate } from '../http.js'
import type { TwitchConnectionResponse } from '../integrations/twitch/types.js'
import { AppError } from '../types.js'
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

    sendConfigUpdate(res, { channelPointsRewardId: config.channelPointsRewardId, chatCommands: config.chatCommands }, rejected)
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

router.post(
  '/rewards',
  localOnly,
  asyncHandler(async (req, res) => {
    const client = getClient()

    if (!client || !getPublicSecretsView().twitch.connected) {
      throw new AppError('TWITCH_NOT_CONNECTED', 'Twitch account is not connected')
    }

    const {
      title,
      cost,
      prompt,
      is_enabled,
      background_color,
      is_max_per_stream_enabled,
      max_per_stream,
      is_max_per_user_per_stream_enabled,
      max_per_user_per_stream,
      is_global_cooldown_enabled,
      global_cooldown_seconds
    } = req.body

    if (!title || typeof title !== 'string') {
      throw new AppError('INVALID_INPUT', 'Title is required')
    }

    if (title.length > 45) {
      throw new AppError('INVALID_INPUT', 'Title must be 45 characters or less')
    }

    if (!cost || typeof cost !== 'number' || cost < 1) {
      throw new AppError('INVALID_INPUT', 'Cost must be a number greater than 0')
    }

    if (prompt && typeof prompt === 'string' && prompt.length > 140) {
      throw new AppError('INVALID_INPUT', 'Prompt must be 140 characters or less')
    }

    if (background_color && typeof background_color === 'string') {
      const hexRegex = /^[0-9A-Fa-f]{6}$/
      if (!hexRegex.test(background_color)) {
        throw new AppError('INVALID_INPUT', 'Background color must be 6 hex characters (e.g., 00FF00)')
      }
    }

    if (is_max_per_stream_enabled && (typeof max_per_stream !== 'number' || max_per_stream < 1)) {
      throw new AppError('INVALID_INPUT', 'Max per stream must be a number greater than 0 when enabled')
    }

    if (is_max_per_user_per_stream_enabled && (typeof max_per_user_per_stream !== 'number' || max_per_user_per_stream < 1)) {
      throw new AppError('INVALID_INPUT', 'Max per user per stream must be a number greater than 0 when enabled')
    }

    if (is_global_cooldown_enabled && (typeof global_cooldown_seconds !== 'number' || global_cooldown_seconds < 1)) {
      throw new AppError('INVALID_INPUT', 'Global cooldown must be a number greater than 0 when enabled')
    }

    const reward = await client.createCustomReward({
      title,
      cost,
      prompt,
      is_enabled,
      background_color,
      is_max_per_stream_enabled,
      max_per_stream,
      is_max_per_user_per_stream_enabled,
      max_per_user_per_stream,
      is_global_cooldown_enabled,
      global_cooldown_seconds
    })

    ok(res, { reward })
  })
)

router.patch(
  '/rewards/:id',
  localOnly,
  asyncHandler<{ id: string }>(async (req, res) => {
    const client = getClient()

    if (!client || !getPublicSecretsView().twitch.connected) {
      throw new AppError('TWITCH_NOT_CONNECTED', 'Twitch account is not connected')
    }

    const {
      title,
      cost,
      prompt,
      is_enabled,
      background_color,
      is_max_per_stream_enabled,
      max_per_stream,
      is_max_per_user_per_stream_enabled,
      max_per_user_per_stream,
      is_global_cooldown_enabled,
      global_cooldown_seconds
    } = req.body

    if (title && typeof title === 'string' && title.length > 45) {
      throw new AppError('INVALID_INPUT', 'Title must be 45 characters or less')
    }

    if (cost && (typeof cost !== 'number' || cost < 1)) {
      throw new AppError('INVALID_INPUT', 'Cost must be a number greater than 0')
    }

    if (prompt && typeof prompt === 'string' && prompt.length > 140) {
      throw new AppError('INVALID_INPUT', 'Prompt must be 140 characters or less')
    }

    if (background_color && typeof background_color === 'string') {
      const hexRegex = /^#[0-9A-Fa-f]{6}$/
      if (!hexRegex.test(background_color)) {
        throw new AppError('INVALID_INPUT', 'Background color must be 6 hex characters (e.g., 00FF00)')
      }
    }

    if (is_max_per_stream_enabled && (typeof max_per_stream !== 'number' || max_per_stream < 1)) {
      throw new AppError('INVALID_INPUT', 'Max per stream must be a number greater than 0 when enabled')
    }

    if (is_max_per_user_per_stream_enabled && (typeof max_per_user_per_stream !== 'number' || max_per_user_per_stream < 1)) {
      throw new AppError('INVALID_INPUT', 'Max per user per stream must be a number greater than 0 when enabled')
    }

    if (is_global_cooldown_enabled && (typeof global_cooldown_seconds !== 'number' || global_cooldown_seconds < 1)) {
      throw new AppError('INVALID_INPUT', 'Global cooldown must be a number greater than 0 when enabled')
    }

    const reward = await client.updateCustomReward(req.params.id, {
      title,
      cost,
      prompt,
      is_enabled,
      background_color,
      is_max_per_stream_enabled,
      max_per_stream,
      is_max_per_user_per_stream_enabled,
      max_per_user_per_stream,
      is_global_cooldown_enabled,
      global_cooldown_seconds
    })

    ok(res, { reward })
  })
)
