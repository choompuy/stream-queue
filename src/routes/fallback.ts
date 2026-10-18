import express from 'express'
import { StateResponse, QueueItem, FallbackEnqueueResponse, AppError } from '../types.js'
import { ok } from '../http.js'
import { validateVideoIdParam } from '../validate.js'
import {
  refreshFallback,
  getFallbackState,
  toggleFallbackShuffle,
  toggleFallbackRepeat,
  toggleFallbackEnabled,
  playFallbackTrackNow,
  queueFallbackTrack
} from '../fallback.js'
import { getState } from '../player.js'

function fallbackTrackOrNotFound(item: QueueItem | null): QueueItem {
  if (!item) throw new AppError('NOT_FOUND')
  return item
}

export const router = express.Router()

router.param('videoId', validateVideoIdParam)

router.get('/', (_req, res) => {
  ok(res, getFallbackState())
})

router.post('/refresh', async (_req, res) => {
  ok(res, await refreshFallback())
})

router.post('/shuffle', (_req, res) => {
  ok(res, toggleFallbackShuffle())
})

router.post('/repeat', (_req, res) => {
  ok(res, toggleFallbackRepeat())
})

router.post('/enabled', (_req, res) => {
  ok(res, toggleFallbackEnabled())
})

router.post('/play/:videoId', (req, res) => {
  fallbackTrackOrNotFound(playFallbackTrackNow(req.params.videoId))
  ok<StateResponse>(res, getState())
})

router.post('/enqueue/:videoId', (req, res) => {
  const item = fallbackTrackOrNotFound(queueFallbackTrack(req.params.videoId))
  ok<FallbackEnqueueResponse>(res, { song: item, state: getState() }, 201)
})
