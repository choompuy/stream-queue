import express from 'express'
import { ConfigResponse, AppError } from '../types.js'
import { ok } from '../http.js'
import { getConfig, updateConfig } from '../config.js'
import { parsePlaylistId } from '../youtube/url.js'
import { fetchPlaylistMeta } from '../youtube/index.js'
import { getPlaylists, upsertPlaylist, removePlaylist, type PlaylistEntry } from '../playlists.js'
import { clearFallback, refreshFallbackOrRollback } from '../fallback.js'
import { createLogger } from '../logger.js'
import { checkPlaylistId, validatePlaylistIdParam } from '../validate.js'
import { emit } from '../state-events.js'

const log = createLogger('PLAYLISTS')

export const router = express.Router()

router.param('id', validatePlaylistIdParam)

// every playlist says whether it is the active one, so the panel does not have to look it up in the config
function playlistEntries(): PlaylistEntry[] {
  const activeId = getConfig().fallbackPlaylist.playlistId
  return getPlaylists().map((playlist) => ({ ...playlist, isActive: playlist.id === activeId }))
}

router.get('/', (_req, res) => {
  ok(res, { playlists: playlistEntries() })
})

router.post('/', async (req, res) => {
  const raw = typeof req.body?.playlistId === 'string' ? req.body.playlistId : ''
  const parsedId = parsePlaylistId(raw)

  if (!parsedId) {
    throw new AppError('INVALID_PLAYLIST_ID', 'a valid playlist ID or URL is required')
  }

  const meta = await fetchPlaylistMeta(parsedId)
  if (!meta) {
    throw new AppError('PLAYLIST_NOT_FOUND', 'no playlist has that id')
  }

  const saved = upsertPlaylist(meta)
  ok(res, { playlist: saved }, 201)
})

router.delete('/:id', (req, res) => {
  const removed = removePlaylist(req.params.id)
  if (!removed) {
    throw new AppError('PLAYLIST_NOT_FOUND', 'no saved playlist has that id')
  }

  const wasActive = getConfig().fallbackPlaylist.playlistId === req.params.id

  if (wasActive) {
    clearFallback()
    log.log(`active playlist "${req.params.id}" removed - fallback cleared`)
  }

  ok(res, { playlists: playlistEntries(), fallbackCleared: wasActive })
})

router.post('/:id/activate', async (req, res) => {
  const { id } = req.params

  checkPlaylistId(id)

  if (!getPlaylists().some((playlist) => playlist.id === id)) {
    throw new AppError('PLAYLIST_NOT_FOUND', 'no saved playlist has that id')
  }

  const previousId = getConfig().fallbackPlaylist.playlistId
  if (previousId === id) {
    clearFallback()
    log.log(`deactivated playlist "${id}"`)
    return ok<ConfigResponse>(res, getConfig())
  }

  updateConfig({ fallbackPlaylist: { playlistId: id } })
  await refreshFallbackOrRollback(previousId)
  emit('playlists')
  ok<ConfigResponse>(res, getConfig())
})
