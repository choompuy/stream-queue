import express from 'express'
import { AppError } from '../types.js'
import { ok } from '../http.js'
import { checkVideoId, validateVideoIdParam } from '../validate.js'
import { getBlockedTracks, blockTrack, unblockTrack } from '../blocklist.js'
import { skipIfCurrent } from '../player.js'

export const router = express.Router()

router.param('videoId', validateVideoIdParam)

router.get('/', (_req, res) => {
  ok(res, { entries: getBlockedTracks() })
})

router.post('/', (req, res) => {
  const { videoId, title } = req.body ?? {}

  checkVideoId(videoId)

  const entry = blockTrack(videoId, typeof title === 'string' ? title.slice(0, 200) : videoId)
  const skipped = skipIfCurrent(videoId)
  ok(res, { entry, skipped }, 201)
})

router.delete('/:videoId', (req, res) => {
  const removed = unblockTrack(req.params.videoId)

  if (!removed) throw new AppError('NOT_FOUND')
  ok(res, { removed: true })
})
