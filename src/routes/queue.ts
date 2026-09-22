import express from 'express'
import { StateResponse, QueueRemoveResponse, QueueRequestResponse } from '../types.js'
import { ok, fail, failFromError, asyncHandler } from '../http.js'
import { isLoopbackAddress } from '../local-only.js'
import { translateWithFallback } from '../i18n.js'
import { requestSong, removeAt, clearQueue } from '../queue.js'
import { getState } from '../player.js'

export const router = express.Router()

router.post(
  '/request',
  asyncHandler(async (req, res) => {
    const { query, requestedBy, admin } = req.body ?? {}
    const bypassFilters = admin === true && isLoopbackAddress(req.socket.remoteAddress)

    if (typeof query !== 'string' || query.trim().length < 2 || query.trim().length > 200) {
      return fail(res, 'query must be between 2 and 200 characters', 'INVALID_QUERY', 400)
    }

    if (typeof requestedBy !== 'string' || requestedBy.trim().length === 0) {
      return fail(res, 'username is required', 'USERNAME_REQUIRED', 400)
    }

    const result = await requestSong(query.trim(), requestedBy.trim(), bypassFilters)

    switch (result.outcome) {
      case 'invalid-url':
        return fail(res, 'invalid YouTube URL', 'INVALID_YOUTUBE_URL', 400)
      case 'not-found':
        return fail(res, 'could not find a suitable track', 'SONG_NOT_FOUND', 404)
      case 'error':
        return failFromError(res, result.error)
      case 'added': {
        const { added } = result
        const message = added.started
          ? translateWithFallback('toast.nowPlaying', { title: added.song.title }, `Now playing: ${added.song.title}`)
          : translateWithFallback(
              'toast.addedToQueue',
              { title: added.song.title, position: added.position },
              `Added to queue: ${added.song.title} [#${added.position}]`
            )
        return ok<QueueRequestResponse>(res, { ...added, state: getState(), message }, 201)
      }
    }
  })
)

router.delete('/:index', (req, res) => {
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

router.post('/clear', (_req, res) => {
  clearQueue()
  ok<StateResponse>(res, getState())
})
