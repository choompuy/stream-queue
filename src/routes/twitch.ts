import express from 'express'
import { ok, sendConfigUpdate } from '../http.js'
import type { TwitchConnectionResponse, TwitchCreateCustomReward, TwitchUpdateCustomReward } from '../integrations/twitch/types.js'
import { AppError } from '../types.js'
import { parseRewardInput, toRewardDto } from '../integrations/twitch/rewards.js'
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
    rewards: rewards.filter((reward) => reward.is_user_input_required).map(toRewardDto)
  })
})

// A reward is saved like a config: the answer is { config: the stored reward, rejected: the names the panel has to mark }
router.post('/rewards', localOnly, async (req, res) => {
  const client = requireClient()
  const { payload, rejected } = parseRewardInput(req.body, { requireTitleAndCost: true })
  if (rejected.length) return sendConfigUpdate(res, {}, rejected)

  const reward = await client.createCustomReward(payload as TwitchCreateCustomReward)
  sendConfigUpdate(res, toRewardDto(reward), [])
})

router.patch('/rewards/:id', localOnly, async (req, res) => {
  const client = requireClient()
  const { payload, rejected } = parseRewardInput(req.body, { requireTitleAndCost: false })
  if (rejected.length) return sendConfigUpdate(res, {}, rejected)

  const rewardId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
  const reward = await client.updateCustomReward(rewardId, payload as TwitchUpdateCustomReward)
  sendConfigUpdate(res, toRewardDto(reward), [])
})
