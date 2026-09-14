import express from 'express'
import cors from 'cors'
import { exec } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  StateResponse,
  SettingsResponse,
  PreviewStateResponse,
  ConfigResponse,
  SearchResponse,
  QueueRemoveResponse,
  SecretsResponse,
  ActivityResponse
} from './types.js'
import { findAvailablePort } from './port.js'
import { ok, fail, failFromError, asyncHandler } from './http.js'
import { getPublicSecretsView, updateSecrets } from './secrets.js'
import { getConfig, updateConfig } from './config.js'
import { getSettings, updateSettings } from './settings.js'
import { searchSongs, fetchPlaylistMeta } from './youtube/index.js'
import { parsePlaylistId } from './youtube/url.js'
import { getPlaylists, upsertPlaylist, removePlaylist } from './playlists.js'
import { getState, removeAt, clearQueue, moveToNext, skipCurrent, setPaused, requestSong } from './queue.js'
import {
  refreshFallback,
  getFallbackState,
  toggleFallbackShuffle,
  toggleFallbackRepeat,
  toggleFallbackEnabled,
  clearFallback,
  playFallbackTrackNow,
  queueFallbackTrack
} from './fallback.js'
import { getActivity, clearActivity } from './activity.js'

const app = express()
const PORT = await findAvailablePort(3000)

const LAN_HOSTNAME_PATTERN = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true)

      try {
        const { hostname } = new URL(origin)
        const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1'
        const isLan = LAN_HOSTNAME_PATTERN.test(hostname)

        if (isLocalHost || isLan) return callback(null, true)
      } catch {
        // not a valid origin - fall through to rejection below
      }

      callback(new Error('Not allowed by CORS'))
    }
  })
)
app.use(express.json({ limit: '50kb' }))
app.use(express.static(path.join(__dirname, '../public')))

function log(message: string) {
  console.log(`[SERVER] ${message}`)
}

app.get('/api/network-info', (_req, res) => {
  const ips: string[] = []
  const interfaces = os.networkInterfaces()

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address)
      }
    }
  }

  ok(res, { port: PORT, ips })
})

app.get('/preview', (_req, res) => {
  res.sendFile('preview.html', {
    root: path.join(__dirname, '../public')
  })
})

app.get('/api/state', (_req, res) => {
  ok<StateResponse>(res, getState())
})

app.get('/api/settings', (_req, res) => {
  ok<SettingsResponse>(res, getSettings())
})

app.put('/api/settings', (req, res) => {
  const updates = req.body ?? {}
  const updated = updateSettings(updates)
  ok<SettingsResponse>(res, updated)
})

app.get('/api/preview-state', (_req, res) => {
  ok<PreviewStateResponse>(res, { state: getState(), settings: getSettings() })
})

app.get('/api/locale', (_req, res) => {
  const settings = getSettings()
  ok(res, { locale: settings.locale })
})

app.put('/api/locale', (req, res) => {
  const { locale } = req.body ?? {}
  const validLocales = ['ru', 'en']
  
  if (typeof locale !== 'string' || !validLocales.includes(locale)) {
    return fail(res, 'Invalid locale', 'INVALID_LOCALE', 400)
  }
  
  const updated = updateSettings({ locale: locale as 'ru' | 'en' })
  ok<SettingsResponse>(res, updated)
})

app.get('/api/config', (_req, res) => {
  ok<ConfigResponse>(res, getConfig())
})

app.put(
  '/api/config',
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
    const updated = updateConfig(body ?? {})

    if (updated.fallbackPlaylist.playlistId !== previous.fallbackPlaylist.playlistId) {
      try {
        await refreshFallback()
      } catch (error) {
        log(`[ERROR] Failed to refresh fallback playlist: ${error instanceof Error ? error.message : error}`)
        return ok<ConfigResponse>(res, {
          ...updated,
          fallbackPlaylistWarning: 'failed to load playlist, check the ID'
        })
      }
    } else if (updated.fallbackPlaylist.shuffle !== previous.fallbackPlaylist.shuffle) {
      toggleFallbackShuffle()
    }

    ok<ConfigResponse>(res, updated)
  })
)

app.get('/api/playlists', (_req, res) => {
  ok(res, { playlists: getPlaylists() })
})

app.post(
  '/api/playlists',
  asyncHandler(async (req, res) => {
    const raw = typeof req.body?.playlistId === 'string' ? req.body.playlistId : ''
    const parsedId = parsePlaylistId(raw)

    if (!parsedId) {
      return fail(res, 'invalid playlist ID or URL', 'INVALID_PLAYLIST_ID', 400)
    }

    try {
      const meta = await fetchPlaylistMeta(parsedId)
      if (!meta) {
        return fail(res, 'playlist not found', 'PLAYLIST_NOT_FOUND', 404)
      }
      const saved = upsertPlaylist(meta)
      ok(res, { playlist: saved }, 201)
    } catch (error) {
      failFromError(res, error)
    }
  })
)

app.delete('/api/playlists/:id', (req, res) => {
  const removed = removePlaylist(req.params.id)
  if (!removed) {
    return fail(res, 'playlist not found', 'PLAYLIST_NOT_FOUND', 404)
  }

  const wasActive = getConfig().fallbackPlaylist.playlistId === req.params.id

  if (wasActive) {
    clearFallback()
    log(`[PLAYLISTS] active playlist "${req.params.id}" removed - fallback cleared`)
  }

  ok(res, { playlists: getPlaylists(), fallbackCleared: wasActive })
})

app.post(
  '/api/playlists/:id/activate',
  asyncHandler<{ id: string }>(async (req, res) => {
    const config = getConfig()

    if (config.fallbackPlaylist.playlistId === req.params.id) {
      clearFallback()
      log(`[PLAYLISTS] deactivated playlist "${req.params.id}"`)
      return ok<ConfigResponse>(res, getConfig())
    }

    const updated = updateConfig({ fallbackPlaylist: { ...config.fallbackPlaylist, playlistId: req.params.id } })

    try {
      await refreshFallback()
    } catch (error) {
      log(`[ERROR] Failed to activate playlist: ${error instanceof Error ? error.message : error}`)
      return ok<ConfigResponse>(res, { ...updated, fallbackPlaylistWarning: 'failed to load playlist' })
    }

    ok<ConfigResponse>(res, updated)
  })
)

app.get(
  '/api/search',
  asyncHandler(async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    const bypassFilters = req.query.admin === '1'

    if (query.length < 2) {
      return fail(res, 'query must be at least 2 characters', 'INVALID_QUERY', 400)
    }

    try {
      const songs = await searchSongs(query, bypassFilters)
      ok<SearchResponse>(res, { results: songs })
    } catch (error) {
      log(`[ERROR] Search: ${error instanceof Error ? error.message : error}`)
      failFromError(res, error)
    }
  })
)

app.get('/api/activity', (_req, res) => {
  ok<ActivityResponse>(res, { entries: getActivity() })
})

app.post('/api/activity/clear', (_req, res) => {
  clearActivity()
  ok<ActivityResponse>(res, { entries: getActivity() })
})

app.post(
  '/api/queue/request',
  asyncHandler(async (req, res) => {
    const { query, requestedBy, admin } = req.body ?? {}
    const bypassFilters = admin === true

    if (typeof query !== 'string' || query.trim().length < 2 || query.trim().length > 200) {
      return fail(res, 'query must be between 2 and 200 characters', 'INVALID_QUERY', 400)
    }

    if (typeof requestedBy !== 'string' || requestedBy.trim().length === 0) {
      return fail(res, 'username is required', 'INVALID_REQUEST', 400)
    }

    const result = await requestSong(query.trim(), requestedBy.trim(), bypassFilters)

    switch (result.outcome) {
      case 'invalid-url':
        return fail(res, 'invalid YouTube URL', 'INVALID_YOUTUBE_URL', 400)
      case 'not-found':
        return fail(res, 'could not find a suitable track', 'SONG_NOT_FOUND', 404)
      case 'error':
        return failFromError(res, result.error)
      case 'added':
        return ok(res, result.response, 201)
    }
  })
)

app.post('/api/player/ended', (_req, res) => {
  moveToNext()
  ok<StateResponse>(res, getState())
})

app.post('/api/player/skip', (_req, res) => {
  skipCurrent()
  ok<StateResponse>(res, getState())
})

app.post('/api/player/pause', (_req, res) => {
  setPaused(true)
  ok<StateResponse>(res, getState())
})

app.post('/api/player/resume', (_req, res) => {
  setPaused(false)
  ok<StateResponse>(res, getState())
})

app.get('/api/fallback', (_req, res) => {
  ok(res, getFallbackState())
})

app.post(
  '/api/fallback/refresh',
  asyncHandler(async (_req, res) => {
    ok(res, await refreshFallback())
  })
)

app.post('/api/fallback/shuffle', (_req, res) => {
  ok(res, toggleFallbackShuffle())
})

app.post('/api/fallback/repeat', (_req, res) => {
  ok(res, toggleFallbackRepeat())
})

app.post('/api/fallback/enabled', (_req, res) => {
  ok(res, toggleFallbackEnabled())
})

app.post('/api/fallback/play/:videoId', (req, res) => {
  const item = playFallbackTrackNow(req.params.videoId)
  if (!item) return fail(res, 'track not found in fallback', 'NOT_FOUND', 404)
  ok<StateResponse>(res, getState())
})

app.post('/api/fallback/enqueue/:videoId', (req, res) => {
  try {
    const item = queueFallbackTrack(req.params.videoId)
    if (!item) return fail(res, 'track not found in fallback', 'NOT_FOUND', 404)
    ok(res, { song: item, state: getState() }, 201)
  } catch (error) {
    failFromError(res, error)
  }
})

app.delete('/api/queue/:index', (req, res) => {
  const index = Number(req.params.index)

  if (!Number.isInteger(index) || index < 0) {
    return fail(res, 'invalid index', 'INVALID_INDEX', 400)
  }

  const removed = removeAt(index)

  if (!removed) {
    return fail(res, 'queue item not found', 'QUEUE_ITEM_NOT_FOUND', 404)
  }

  ok<QueueRemoveResponse>(res, { removed, state: getState() })
})

app.post('/api/queue/clear', (_req, res) => {
  clearQueue()
  ok<StateResponse>(res, getState())
})

app.get('/api/secrets', (_req, res) => {
  ok<SecretsResponse>(res, getPublicSecretsView())
})

app.put('/api/secrets', (req, res) => {
  updateSecrets(req.body ?? {})
  ok<SecretsResponse>(res, getPublicSecretsView())
})

app.use('/api', (_req, res) => {
  fail(res, 'API endpoint not found', 'NOT_FOUND', 404)
})

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  log(`[ERROR] ${err.message}`)
  fail(res, 'internal server error', 'SERVER_ERROR', 500)
})

function openBrowser(url: string): void {
  if (process.platform === 'win32') {
    exec(`start "" "${url}"`)
    return
  }

  if (process.platform === 'darwin') {
    exec(`open "${url}"`)
    return
  }

  exec(`xdg-open "${url}"`)
}

app.listen(PORT, async () => {
  log(`Server running on http://localhost:${PORT}`)
  await refreshFallback()
  if (!getState().current) {
    moveToNext()
  }
  openBrowser(`http://localhost:${PORT}`)
})
