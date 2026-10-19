import express from 'express'
import { ConfigResponse, SettingsResponse } from '../types.js'
import { ok, sendConfigUpdate } from '../http.js'
import { isLocalAddress, localOnly } from '../local-only.js'
import { getConfig, updateConfig } from '../config.js'
import { getSettings, updateSettings } from '../settings.js'
import { getPublicSecretsView, SecretsResponse, updateSecrets } from '../secrets.js'
import { settledConfigReaction } from '../fallback.js'

export const router = express.Router()

router.get('/settings', (_req, res) => {
  ok<SettingsResponse>(res, getSettings())
})

// a partial save, like the config: the valid fields are stored, the refused ones are named
router.put('/settings', (req, res) => {
  const { config, rejected } = updateSettings(req.body ?? {})
  sendConfigUpdate(res, config, rejected)
})

router.get('/config', (_req, res) => {
  ok<ConfigResponse>(res, getConfig())
})

// saves; the fallback module reacts to what changed (a new playlist is loaded, the rotation re-ordered)
// and the route waits for that outcome, so a playlist that cannot be loaded is answered with its error
router.put('/config', async (req, res) => {
  const previous = getConfig()
  const { config: updated, rejected } = updateConfig(req.body ?? {})

  if (updated.fallbackPlaylist.playlistId !== previous.fallbackPlaylist.playlistId) {
    await settledConfigReaction(updated.fallbackPlaylist.playlistId)
  }

  sendConfigUpdate(res, updated, rejected)
})

router.get('/secrets', (req, res) => {
  ok<SecretsResponse>(res, getPublicSecretsView({ includeAuthorization: isLocalAddress(req.socket.remoteAddress) }))
})

router.put('/secrets', localOnly, (req, res) => {
  updateSecrets(req.body ?? {})
  ok<SecretsResponse>(res, getPublicSecretsView({ includeAuthorization: true }))
})
