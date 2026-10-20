import express from 'express'
import { StateResponse, QueueRemoveResponse, QueueRequestResponse, AppError } from '../types.js'
import { ok } from '../http.js'
import { wantsBypassFilters } from '../local-only.js'
import { checkQuery, INPUT_LIMITS, validateVideoIdParam } from '../validate.js'
import { t } from '../i18n.js'
import { requestSong } from '../request.js'
import { removeByVideoId, clearQueue } from '../queue.js'
import { getState } from '../player.js'
import { getSettings } from '../settings.js'

export const router = express.Router()

router.param('videoId', validateVideoIdParam)

router.post('/request', async (req, res) => {
  const { query, requestedBy } = req.body ?? {}
  const bypassFilters = wantsBypassFilters(req)
  const checkedQuery = checkQuery(query)

  if (typeof requestedBy !== 'string' || requestedBy.trim().length === 0) {
    throw new AppError('USERNAME_REQUIRED')
  }

  const added = await requestSong(checkedQuery, requestedBy.trim().slice(0, INPUT_LIMITS.requesterName), { bypassFilters })

  const message = added.started
    ? t(getSettings().locale, 'toast.nowPlaying', { title: added.song.title })
    : t(getSettings().locale, 'toast.addedToQueue', { title: added.song.title, position: added.position })
  return ok<QueueRequestResponse>(res, { ...added, state: getState(), message }, 201)
})

router.delete('/video/:videoId', (req, res) => {
  const removed = removeByVideoId(req.params.videoId)

  if (!removed) {
    throw new AppError('QUEUE_ITEM_NOT_FOUND')
  }

  ok<QueueRemoveResponse>(res, { removed, state: getState() })
})

router.post('/clear', (_req, res) => {
  clearQueue()
  ok<StateResponse>(res, getState())
})
