import express from 'express'
import { ConfigResponse } from '../types.js'
import { ok, fail, failFromError } from '../http.js'
import { getConfig, updateConfig } from '../config.js'
import { parsePlaylistId, isValidPlaylistId } from '../youtube/url.js'
import { fetchPlaylistMeta } from '../youtube/index.js'
import { getPlaylists, upsertPlaylist, removePlaylist } from '../playlists.js'
import { clearFallback, refreshFallbackOrRollback } from '../fallback.js'
import { createLogger } from '../logger.js'

const log = createLogger('PLAYLISTS')

export const router = express.Router()

router.get('/', (_req, res) => {
  ok(res, { playlists: getPlaylists() })
})

router.post('/', async (req, res) => {
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

router.delete('/:id', (req, res) => {
  const removed = removePlaylist(req.params.id)
  if (!removed) {
    return fail(res, 'playlist not found', 'PLAYLIST_NOT_FOUND', 404)
  }

  const wasActive = getConfig().fallbackPlaylist.playlistId === req.params.id

  if (wasActive) {
    clearFallback()
    log.log(`active playlist "${req.params.id}" removed - fallback cleared`)
  }

  ok(res, { playlists: getPlaylists(), fallbackCleared: wasActive })
})

router.post('/:id/activate', async (req, res) => {
  const { id } = req.params

  if (!isValidPlaylistId(id)) {
    return fail(res, 'invalid playlist ID or URL', 'INVALID_PLAYLIST_ID', 400)
  }

  if (!getPlaylists().some((playlist) => playlist.id === id)) {
    return fail(res, 'playlist not found', 'PLAYLIST_NOT_FOUND', 404)
  }

  const previousId = getConfig().fallbackPlaylist.playlistId
  if (previousId === id) {
    clearFallback()
    log.log(`deactivated playlist "${id}"`)
    return ok<ConfigResponse>(res, getConfig())
  }

  updateConfig({ fallbackPlaylist: { playlistId: id } })
  await refreshFallbackOrRollback(previousId)
  ok<ConfigResponse>(res, getConfig())
})
