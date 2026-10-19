import express from 'express'
import { ConfigResponse, AppError } from '../types.js'
import { ok } from '../http.js'
import { getConfig, updateConfig } from '../config.js'
import { fetchPlaylistMeta } from '../youtube/index.js'
import { getPlaylists, upsertPlaylist, removePlaylist, type PlaylistEntry } from '../playlists.js'
import { clearFallback, settledConfigReaction } from '../fallback.js'
import { createLogger } from '../logger.js'
import { checkPlaylistIdOrUrl, validatePlaylistIdParam } from '../validate.js'

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
  const parsedId = checkPlaylistIdOrUrl(req.body?.playlistId)

  const meta = await fetchPlaylistMeta(parsedId)
  if (!meta) {
    throw new AppError('PLAYLIST_NOT_FOUND')
  }

  const saved = upsertPlaylist(meta)
  ok(res, { playlist: saved }, 201)
})

router.delete('/:id', (req, res) => {
  const removed = removePlaylist(req.params.id)
  if (!removed) {
    throw new AppError('PLAYLIST_NOT_FOUND')
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

  // the shape of :id was already checked by the shared router.param before the route runs
  if (!getPlaylists().some((playlist) => playlist.id === id)) {
    throw new AppError('PLAYLIST_NOT_FOUND')
  }

  const previousId = getConfig().fallbackPlaylist.playlistId
  if (previousId === id) {
    clearFallback()
    log.log(`deactivated playlist "${id}"`)
    return ok<ConfigResponse>(res, getConfig())
  }

  // saves; the fallback module loads the playlist and the route answers with the outcome of that load
  updateConfig({ fallbackPlaylist: { playlistId: id } })
  await settledConfigReaction(id)
  ok<ConfigResponse>(res, getConfig())
})
