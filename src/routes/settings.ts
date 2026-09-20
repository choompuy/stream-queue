import express from 'express'
import { ConfigResponse, SettingsResponse, SecretsResponse } from '../types.js'
import { ok, fail, failFromError, asyncHandler } from '../http.js'
import { getConfig, updateConfig, restoreConfig, validateConfigUpdates } from '../config.js'
import { getSettings, updateSettings, validateSettingsUpdates } from '../settings.js'
import { getPublicSecretsView, updateSecrets } from '../secrets.js'
import { parsePlaylistId } from '../youtube/url.js'
import { refreshFallback, reorderFallback } from '../fallback.js'

function log(message: string): void {
  console.log(`[SERVER] ${message}`)
}

export const router = express.Router()

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

router.get('/locale', (_req, res) => {
  const settings = getSettings()
  ok(res, { locale: settings.locale })
})

router.put('/locale', (req, res) => {
  const { locale } = req.body ?? {}
  const validLocales = ['en', 'ru']

  if (typeof locale !== 'string' || !validLocales.includes(locale)) {
    return fail(res, 'Invalid locale', 'INVALID_LOCALE', 400)
  }

  const updated = updateSettings({ locale: locale as 'en' | 'ru' })
  ok<SettingsResponse>(res, updated)
})

router.get('/config', (_req, res) => {
  ok<ConfigResponse>(res, getConfig())
})

router.put(
  '/config',
  asyncHandler(async (req, res) => {
    const body = { ...(req.body ?? {}) }

    if (body.fallbackPlaylist && typeof body.fallbackPlaylist.playlistId === 'string') {
      const rawPlaylistId = body.fallbackPlaylist.playlistId.trim()

      if (rawPlaylistId) {
        const parsedId = parsePlaylistId(rawPlaylistId)
        if (!parsedId) {
          return fail(res, 'invalid playlist ID or URL', 'INVALID_PLAYLIST_ID', 400)
        }
        body.fallbackPlaylist = { ...body.fallbackPlaylist, playlistId: parsedId }
      } else {
        body.fallbackPlaylist = { ...body.fallbackPlaylist, playlistId: null }
      }
    }

    // all-or-nothing: a request with any invalid field changes nothing, and says which fields were wrong
    const { rejected } = validateConfigUpdates(body)
    if (rejected.length) {
      return fail(res, 'invalid config fields', 'INVALID_CONFIG', 400, { fields: rejected.join(', ') })
    }

    const previous = getConfig()
    const { config: updated } = updateConfig(body)

    if (updated.fallbackPlaylist.playlistId !== previous.fallbackPlaylist.playlistId) {
      try {
        await refreshFallback()
      } catch (error) {
        // the playlist could not be loaded: keep the previous config as a whole, like any other refused update
        log(`[ERROR] Failed to refresh fallback playlist: ${error instanceof Error ? error.message : error}`)
        restoreConfig(previous)
        return failFromError(res, error)
      }
    } else if (updated.fallbackPlaylist.shuffle !== previous.fallbackPlaylist.shuffle) {
      // updateConfig() already stored the new value: only the order has to follow it
      reorderFallback(updated.fallbackPlaylist.shuffle)
    }

    ok<ConfigResponse>(res, updated)
  })
)

router.get('/secrets', (_req, res) => {
  ok<SecretsResponse>(res, getPublicSecretsView())
})

router.put('/secrets', (req, res) => {
  updateSecrets(req.body ?? {})
  ok<SecretsResponse>(res, getPublicSecretsView())
})
