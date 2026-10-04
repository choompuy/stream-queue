import express from 'express'
import { ConfigResponse, SettingsResponse } from '../types.js'
import { ok, fail, failFromError, asyncHandler, sendConfigUpdate } from '../http.js'
import { localOnly } from '../local-only.js'
import { getConfig, updateConfig, restoreConfig } from '../config.js'
import { getSettings, updateSettings, validateSettingsUpdates } from '../settings.js'
import { getPublicSecretsView, SecretsResponse, updateSecrets } from '../secrets.js'
import { parsePlaylistId } from '../youtube/url.js'
import { refreshFallback, reorderFallback } from '../fallback.js'
import { createLogger, describeError } from '../logger.js'

export const router = express.Router()

const log = createLogger('CONFIG')

router.get('/settings', (_req, res) => {
  ok<SettingsResponse>(res, getSettings())
})

router.put('/settings', (req, res) => {
  const updates = req.body ?? {}

  const { rejected } = validateSettingsUpdates(updates)
  if (rejected.length) {
    return fail(res, 'invalid settings fields', 'INVALID_SETTINGS', 400, { fields: rejected.join(', ') })
  }

  ok<SettingsResponse>(res, updateSettings(updates))
})

router.get('/config', (_req, res) => {
  ok<ConfigResponse>(res, getConfig())
})

router.put(
  '/config',
  asyncHandler(async (req, res) => {
    const body = { ...(req.body ?? {}) }

    if (body.fallbackPlaylist !== undefined) {
      if (typeof body.fallbackPlaylist !== 'object' || body.fallbackPlaylist === null || Array.isArray(body.fallbackPlaylist)) {
        fail(res, 'invalid fallbackPlaylist: must be an object', 'INVALID_CONFIG', 400, { fields: 'fallbackPlaylist' })
        return
      }

      if (typeof body.fallbackPlaylist.playlistId === 'string') {
        const rawPlaylistId = body.fallbackPlaylist.playlistId.trim()

        if (rawPlaylistId) {
          const parsedId = parsePlaylistId(rawPlaylistId)
          if (!parsedId) {
            fail(res, 'invalid playlist ID or URL', 'INVALID_PLAYLIST_ID', 400)
            return
          }
          body.fallbackPlaylist = { ...body.fallbackPlaylist, playlistId: parsedId }
        } else {
          body.fallbackPlaylist = { ...body.fallbackPlaylist, playlistId: null }
        }
      }
    }

    const previous = getConfig()
    const { config: updated, rejected } = updateConfig(body)

    // The valid fields are already stored even when others were refused, so whatever they imply has to
    // happen before the answer - otherwise a playlist saved next to a bad field would stay stored but never
    // be loaded, and the next save (no difference to `previous` any more) would never load it either.
    if (updated.fallbackPlaylist.playlistId !== previous.fallbackPlaylist.playlistId) {
      try {
        await refreshFallback()
      } catch (error) {
        // the playlist could not be loaded: only the playlist change is undone, the other saved fields stay
        log.error(`Failed to refresh fallback playlist: ${describeError(error)}`)
        restoreConfig({ ...getConfig(), fallbackPlaylist: previous.fallbackPlaylist })
        failFromError(res, error)
        return
      }
    } else if (updated.fallbackPlaylist.shuffle !== previous.fallbackPlaylist.shuffle) {
      // updateConfig() already stored the new value: only the order has to follow it
      reorderFallback(updated.fallbackPlaylist.shuffle)
    }

    sendConfigUpdate(res, updated, rejected)
  })
)

router.get('/secrets', (_req, res) => {
  ok<SecretsResponse>(res, getPublicSecretsView())
})

router.put('/secrets', localOnly, (req, res) => {
  updateSecrets(req.body ?? {})
  ok<SecretsResponse>(res, getPublicSecretsView())
})
