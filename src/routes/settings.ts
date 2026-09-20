import express from 'express'
import { ConfigResponse, SettingsResponse, SecretsResponse } from '../types.js'
import { ok, fail, asyncHandler } from '../http.js'
import { getConfig, updateConfig } from '../config.js'
import { getSettings, updateSettings } from '../settings.js'
import { getPublicSecretsView, updateSecrets } from '../secrets.js'
import { parsePlaylistId } from '../youtube/url.js'
import { refreshFallback, toggleFallbackShuffle } from '../fallback.js'

function log(message: string): void {
  console.log(`[SERVER] ${message}`)
}

export const router = express.Router()

router.get('/settings', (_req, res) => {
  ok<SettingsResponse>(res, getSettings())
})

router.put('/settings', (req, res) => {
  const updates = req.body ?? {}
  const updated = updateSettings(updates)
  ok<SettingsResponse>(res, updated)
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

    const previous = getConfig()
    const { config: updated, rejected } = updateConfig(body ?? {})

    if (updated.fallbackPlaylist.playlistId !== previous.fallbackPlaylist.playlistId) {
      try {
        await refreshFallback()
      } catch (error) {
        log(`[ERROR] Failed to refresh fallback playlist: ${error instanceof Error ? error.message : error}`)
        return ok<ConfigResponse>(res, {
          ...updated,
          fallbackPlaylistWarning: 'failed to load playlist, check the ID',
          rejectedFields: rejected.length ? rejected : undefined
        })
      }
    } else if (updated.fallbackPlaylist.shuffle !== previous.fallbackPlaylist.shuffle) {
      toggleFallbackShuffle()
    }

    ok<ConfigResponse>(res, { ...updated, rejectedFields: rejected.length ? rejected : undefined })
  })
)

router.get('/secrets', (_req, res) => {
  ok<SecretsResponse>(res, getPublicSecretsView())
})

router.put('/secrets', (req, res) => {
  updateSecrets(req.body ?? {})
  ok<SecretsResponse>(res, getPublicSecretsView())
})
