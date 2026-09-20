import express from 'express'
import { ok, fail } from '../http.js'
import { isValidVideoId } from '../youtube/url.js'
import { getBlockedTracks, blockTrack, unblockTrack } from '../blocklist.js'
import { skipIfCurrent } from '../player.js'

export const router = express.Router()

router.get('/', (_req, res) => {
  ok(res, { entries: getBlockedTracks() })
})

router.post('/', (req, res) => {
  const { videoId, title } = req.body ?? {}

  if (!isValidVideoId(videoId)) {
    return fail(res, 'a valid videoId is required', 'INVALID_REQUEST', 400)
  }

  const entry = blockTrack(videoId, typeof title === 'string' ? title : videoId)
  const skipped = skipIfCurrent(videoId)
  ok(res, { entry, skipped }, 201)
})

router.delete('/:videoId', (req, res) => {
  const removed = unblockTrack(req.params.videoId)
  if (!removed) return fail(res, 'not found', 'NOT_FOUND', 404)
  ok(res, { removed: true })
})
