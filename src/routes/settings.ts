import express from 'express'
import { ConfigResponse, SettingsResponse, AppError } from '../types.js'
import { ok, sendConfigUpdate } from '../http.js'
import { isLocalAddress, localOnly } from '../local-only.js'
import { getConfig, updateConfig } from '../config.js'
import { getSettings, updateSettings } from '../settings.js'
import { getPublicSecretsView, SecretsResponse, updateSecrets } from '../secrets.js'
import { checkPlaylistIdOrUrl } from '../validate.js'
import { refreshFallbackOrRollback, reorderFallback } from '../fallback.js'

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

router.put('/config', async (req, res) => {
  const body = { ...(req.body ?? {}) }

  if (body.fallbackPlaylist !== undefined) {
    if (typeof body.fallbackPlaylist !== 'object' || body.fallbackPlaylist === null || Array.isArray(body.fallbackPlaylist)) {
      throw new AppError('INVALID_CONFIG', undefined, { fields: 'fallbackPlaylist' })
    }

    if (typeof body.fallbackPlaylist.playlistId === 'string') {
      const rawPlaylistId = body.fallbackPlaylist.playlistId.trim()

      if (rawPlaylistId) {
        body.fallbackPlaylist = { ...body.fallbackPlaylist, playlistId: checkPlaylistIdOrUrl(rawPlaylistId) }
      } else {
        body.fallbackPlaylist = { ...body.fallbackPlaylist, playlistId: null }
      }
    }
  }

  const previous = getConfig()
  const { config: updated, rejected } = updateConfig(body)

  if (updated.fallbackPlaylist.playlistId !== previous.fallbackPlaylist.playlistId) {
    await refreshFallbackOrRollback(previous.fallbackPlaylist.playlistId)
  } else if (updated.fallbackPlaylist.shuffle !== previous.fallbackPlaylist.shuffle) {
    reorderFallback(updated.fallbackPlaylist.shuffle)
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
