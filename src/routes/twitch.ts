import express from 'express'
import { ok, asyncHandler, sendConfigUpdate } from '../http.js'
import type { TwitchConnectionResponse, TwitchCreateCustomReward, TwitchUpdateCustomReward } from '../integrations/twitch/types.js'
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

function requireClient() {
  const client = getClient()
  if (!client || !getPublicSecretsView().twitch.connected) {
    throw new AppError('TWITCH_NOT_CONNECTED', 'Twitch account is not connected')
  }
  return client
}

type RewardPayload = TwitchCreateCustomReward | TwitchUpdateCustomReward

function validateRewardPayload(body: unknown, { requireTitleAndCost }: { requireTitleAndCost: boolean }): RewardPayload {
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
  } = (body ?? {}) as Record<string, unknown>

  if (requireTitleAndCost) {
    if (!title || typeof title !== 'string') throw new AppError('INVALID_INPUT', 'Title is required')
    if (!cost || typeof cost !== 'number' || cost < 1) throw new AppError('INVALID_INPUT', 'Cost must be a number greater than 0')
  } else {
    if (title !== undefined && typeof title !== 'string') throw new AppError('INVALID_INPUT', 'Title must be a string')
    if (cost !== undefined && (typeof cost !== 'number' || cost < 1)) throw new AppError('INVALID_INPUT', 'Cost must be a number greater than 0')
  }

  if (title !== undefined && (title as string).length > 45) {
    throw new AppError('INVALID_INPUT', 'Title must be 45 characters or less')
  }

  if (prompt !== undefined && typeof prompt === 'string' && prompt.length > 140) {
    throw new AppError('INVALID_INPUT', 'Prompt must be 140 characters or less')
  }

  if (background_color !== undefined && typeof background_color === 'string') {
    if (!/^#[0-9A-Fa-f]{6}$/.test(background_color)) {
      throw new AppError('INVALID_INPUT', 'Background color must be a 6-character hex code (e.g., #00FF00)')
    }
  }

  if (is_max_per_stream_enabled && (typeof max_per_stream !== 'number' || max_per_stream < 1)) {
    throw new AppError('INVALID_INPUT', 'Max per stream must be a number greater than 0 when enabled')
  }

  if (is_max_per_user_per_stream_enabled && (typeof max_per_user_per_stream !== 'number' || max_per_user_per_stream < 1)) {
    throw new AppError('INVALID_INPUT', 'Max per user per stream must be a number greater than 0 when enabled')
  }

  if (
    is_global_cooldown_enabled &&
    (typeof global_cooldown_seconds !== 'number' || !Number.isInteger(global_cooldown_seconds) || global_cooldown_seconds < 1)
  ) {
    throw new AppError('INVALID_INPUT', 'Global cooldown must be an integer greater than 0 when enabled')
  }

  return {
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
  } as RewardPayload
}

export const router = express.Router()

router.get('/', (_req, res) => {
  ok<TwitchConnectionResponse>(res, getPublicSecretsView().twitch)
})

router.get('/config', (_req, res) => {
  const twitchConfig = getTwitchConfig()
  const response = {
    channelPointsRewardId: twitchConfig.channelPointsRewardId,
    autoFulfillRedemptions: twitchConfig.autoFulfillRedemptions,
    chatCommands: twitchConfig.chatCommands
  }
  ok(res, response)
})

router.put(
  '/config',
  localOnly,
  asyncHandler(async (req, res) => {
    const { config, rejected } = updateTwitchConfig(req.body)

    sendConfigUpdate(
      res,
      {
        channelPointsRewardId: config.channelPointsRewardId,
        autoFulfillRedemptions: config.autoFulfillRedemptions,
        chatCommands: config.chatCommands
      },
      rejected
    )
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
    const client = requireClient()
    const rewards = await client.getCustomRewards()

    ok(res, {
      rewards: rewards.filter((reward) => reward.is_user_input_required)
    })
  })
)

router.post(
  '/rewards',
  localOnly,
  asyncHandler(async (req, res) => {
    const client = requireClient()
    const payload = validateRewardPayload(req.body, { requireTitleAndCost: true })
    const reward = await client.createCustomReward(payload as TwitchCreateCustomReward)

    ok(res, { reward })
  })
)

router.patch(
  '/rewards/:id',
  localOnly,
  asyncHandler<{ id: string }>(async (req, res) => {
    const client = requireClient()
    const payload = validateRewardPayload(req.body, { requireTitleAndCost: false })
    const reward = await client.updateCustomReward(req.params.id, payload as TwitchUpdateCustomReward)

    ok(res, { reward })
  })
)
