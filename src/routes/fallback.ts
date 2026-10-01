import express from 'express'
import { StateResponse, QueueItem, FallbackEnqueueResponse } from '../types.js'
import { ok, fail, asyncHandler } from '../http.js'
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

function fallbackTrackOrNotFound(res: express.Response, item: QueueItem | null): item is QueueItem {
  if (!item) {
    fail(res, 'track not found in fallback', 'NOT_FOUND', 404)
    return false
  }
  return true
}

export const router = express.Router()

router.get('/', (_req, res) => {
  ok(res, getFallbackState())
})

router.post(
  '/refresh',
  asyncHandler(async (_req, res) => {
    ok(res, await refreshFallback())
  })
)

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
  const item = playFallbackTrackNow(req.params.videoId)
  if (!fallbackTrackOrNotFound(res, item)) return
  ok<StateResponse>(res, getState())
})

router.post('/enqueue/:videoId', (req, res) => {
  const item = queueFallbackTrack(req.params.videoId)
  if (!fallbackTrackOrNotFound(res, item)) return
  ok<FallbackEnqueueResponse>(res, { song: item, state: getState() }, 201)
})
