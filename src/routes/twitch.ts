import express from 'express'
import { ok, sendConfigUpdate } from '../http.js'
import type { TwitchConnectionResponse, TwitchCreateCustomReward, TwitchUpdateCustomReward } from '../integrations/twitch/types.js'
import { AppError } from '../types.js'
import { parseRewardInput, toRewardDto } from '../integrations/twitch/rewards.js'
import { startDeviceAuthorization, disconnect, refreshConnection, isTwitchConnected, getTwitchHealth } from '../integrations/twitch/index.js'
import { getRuntime } from '../integrations/twitch/state.js'
import { getTwitchConfig, updateTwitchConfig } from '../integrations/twitch/config.js'
import { isLocal, localOnly } from '../local-only.js'
import { getPublicSecretsView } from '../secrets.js'
import type { TwitchClient } from '../integrations/twitch/client.js'

function requireClient(): TwitchClient {
  const runtime = getRuntime()
  if (!runtime || !isTwitchConnected()) {
    throw new AppError('TWITCH_NOT_CONNECTED')
  }
  return runtime.client
}

export const router = express.Router()

// open on purpose (the panel on a phone or from a QR code reads it), so what only this computer may see is left out for the rest
router.get('/', (req, res) => {
  const twitch = getPublicSecretsView({ includeAuthorization: isLocal(req) }).twitch
  ok<TwitchConnectionResponse>(res, { ...twitch, health: getTwitchHealth() })
})

router.get('/config', (_req, res) => {
  ok(res, getTwitchConfig())
})

// everything below is for this machine only
router.use(localOnly)

router.put('/config', async (req, res) => {
  const { config, rejected } = updateTwitchConfig(req.body)
  sendConfigUpdate(res, config, rejected)
})

router.post('/connect', async (_req, res) => {
  const device = await startDeviceAuthorization()

  ok(res, {
    userCode: device.user_code,
    verificationUri: device.verification_uri,
    expiresIn: device.expires_in
  })
})

router.post('/disconnect', async (_req, res) => {
  const openRedemptions = await disconnect()
  ok(res, { openRedemptions })
})

router.post('/refresh', async (_req, res) => {
  const userInfo = await refreshConnection()
  ok(res, { user: { displayName: userInfo.displayName, login: userInfo.login } })
})

router.get('/rewards', async (_req, res) => {
  const client = requireClient()
  const rewards = await client.getCustomRewards()

  ok(res, {
    rewards: rewards.filter((reward) => reward.is_user_input_required).map(toRewardDto)
  })
})

// A reward is saved like a config: the answer is { config: the stored reward, rejected: the names the panel has to mark }
router.post('/rewards', async (req, res) => {
  const client = requireClient()
  const { payload, rejected } = parseRewardInput(req.body, { requireTitleAndCost: true })
  if (rejected.length) return sendConfigUpdate(res, {}, rejected)

  const reward = await client.createCustomReward(payload as TwitchCreateCustomReward)
  sendConfigUpdate(res, toRewardDto(reward), [])
})

router.patch('/rewards/:id', async (req, res) => {
  const client = requireClient()
  const { payload, rejected } = parseRewardInput(req.body, { requireTitleAndCost: false })
  if (rejected.length) return sendConfigUpdate(res, {}, rejected)

  const rewardId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
  const reward = await client.updateCustomReward(rewardId, payload as TwitchUpdateCustomReward)
  sendConfigUpdate(res, toRewardDto(reward), [])
})
