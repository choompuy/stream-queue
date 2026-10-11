import express from 'express'
import { ok, sendConfigUpdate } from '../http.js'
import type { TwitchConnectionResponse, TwitchCreateCustomReward, TwitchUpdateCustomReward } from '../integrations/twitch/types.js'
import { AppError } from '../types.js'
import { startDeviceAuthorization, disconnect, refreshConnection, getClient, getTwitchHealth } from '../integrations/twitch/index.js'
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

// The message is for the log (English); the panel shows the translated INVALID_REWARD text with the name of the field
function invalid(field: string, detail: string): never {
  throw new AppError('INVALID_REWARD', detail, { field })
}

const isPositiveInteger = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1

function optional<T>(field: string, value: unknown, isValid: (v: unknown) => v is T, detail: string): T | undefined {
  if (value === undefined) return undefined
  if (!isValid(value)) invalid(field, detail)
  return value as T
}

const isString = (value: unknown): value is string => typeof value === 'string'
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'

function validateRewardPayload(body: unknown, { requireTitleAndCost }: { requireTitleAndCost: boolean }): RewardPayload {
  const input = (body ?? {}) as Record<string, unknown>

  const title = optional('title', input.title, isString, 'Title must be a string')?.trim()
  const cost = optional('cost', input.cost, isPositiveInteger, 'Cost must be a whole number greater than 0')

  if (requireTitleAndCost) {
    if (!title) invalid('title', 'Title is required')
    if (cost === undefined) invalid('cost', 'Cost is required')
  } else if (title !== undefined && !title) {
    invalid('title', 'Title must not be empty')
  }

  if (title !== undefined && title.length > 45) invalid('title', 'Title must be 45 characters or less')

  const prompt = optional('prompt', input.prompt, isString, 'Prompt must be a string')
  if (prompt !== undefined && prompt.length > 140) invalid('prompt', 'Prompt must be 140 characters or less')

  const background_color = optional('background_color', input.background_color, isString, 'Background color must be a string')
  if (background_color !== undefined && !/^#[0-9A-Fa-f]{6}$/.test(background_color)) {
    invalid('background_color', 'Background color must be a 6-character hex code (e.g., #00FF00)')
  }

  const is_enabled = optional('is_enabled', input.is_enabled, isBoolean, 'is_enabled must be true or false')
  const is_max_per_stream_enabled = optional('is_max_per_stream_enabled', input.is_max_per_stream_enabled, isBoolean, 'Must be true or false')
  const is_max_per_user_per_stream_enabled = optional(
    'is_max_per_user_per_stream_enabled',
    input.is_max_per_user_per_stream_enabled,
    isBoolean,
    'Must be true or false'
  )
  const is_global_cooldown_enabled = optional('is_global_cooldown_enabled', input.is_global_cooldown_enabled, isBoolean, 'Must be true or false')

  // a limit is a whole number greater than 0 whenever it is given, and has to be given when its switch is on
  const limit = (field: string, enabled: boolean | undefined): number | undefined => {
    const value = optional(field, input[field], isPositiveInteger, 'Must be a whole number greater than 0')
    if (enabled && value === undefined) invalid(field, 'Must be set when enabled')
    return value
  }

  return {
    title,
    cost,
    prompt,
    is_enabled,
    background_color,
    is_max_per_stream_enabled,
    max_per_stream: limit('max_per_stream', is_max_per_stream_enabled),
    is_max_per_user_per_stream_enabled,
    max_per_user_per_stream: limit('max_per_user_per_stream', is_max_per_user_per_stream_enabled),
    is_global_cooldown_enabled,
    global_cooldown_seconds: limit('global_cooldown_seconds', is_global_cooldown_enabled)
  } as RewardPayload
}

export const router = express.Router()

router.get('/', (_req, res) => {
  ok<TwitchConnectionResponse>(res, { ...getPublicSecretsView().twitch, health: getTwitchHealth() })
})

router.get('/config', (_req, res) => {
  ok(res, getTwitchConfig())
})

router.put('/config', localOnly, async (req, res) => {
  const { config, rejected } = updateTwitchConfig(req.body)
  sendConfigUpdate(res, config, rejected)
})

router.post('/connect', localOnly, async (_req, res) => {
  const device = await startDeviceAuthorization()

  ok(res, {
    userCode: device.user_code,
    verificationUri: device.verification_uri,
    expiresIn: device.expires_in
  })
})

router.post('/disconnect', localOnly, async (_req, res) => {
  const openRedemptions = await disconnect()
  ok(res, { openRedemptions })
})

router.post('/refresh', localOnly, async (_req, res) => {
  const userInfo = await refreshConnection()
  ok(res, { user: toUserResponse(userInfo) })
})

router.get('/rewards', localOnly, async (_req, res) => {
  const client = requireClient()
  const rewards = await client.getCustomRewards()

  ok(res, {
    rewards: rewards.filter((reward) => reward.is_user_input_required)
  })
})

router.post('/rewards', localOnly, async (req, res) => {
  const client = requireClient()
  const payload = validateRewardPayload(req.body, { requireTitleAndCost: true })
  const reward = await client.createCustomReward(payload as TwitchCreateCustomReward)

  ok(res, { reward })
})

router.patch('/rewards/:id', localOnly, async (req, res) => {
  const client = requireClient()
  const payload = validateRewardPayload(req.body, { requireTitleAndCost: false })
  const rewardId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
  const reward = await client.updateCustomReward(rewardId, payload as TwitchUpdateCustomReward)

  ok(res, { reward })
})
