import express from 'express'
import { PlayerActionResponse, PlayerState } from '../types.js'
import { ok, fail } from '../http.js'
import { isValidVideoId } from '../youtube/url.js'
import { translateWithFallback } from '../i18n.js'
import { setPaused } from '../queue.js'
import { getState, endCurrent, skipCurrent, reportPlaybackFailure } from '../player.js'
import { createRateLimiter } from '../rate-limit.js'

function buildSkipMessage(state: PlayerState): string {
  return state.current?.title
    ? translateWithFallback('chat.skippedNowPlaying', { title: state.current.title }, `Track skipped. Now playing: ${state.current.title}`)
    : translateWithFallback('chat.skipped', undefined, 'Track skipped')
}

export const router = express.Router()

const reportFailureLimiter = createRateLimiter({ windowMs: 60_000, max: 20, keyPrefix: 'report-failure' })

// `videoId` says which track the client is talking about; without it the report is taken to be about the current one
function readVideoId(body: unknown): { videoId?: string; valid: boolean } {
  const videoId = (body as { videoId?: unknown } | undefined)?.videoId
  if (videoId === undefined) return { valid: true }
  return isValidVideoId(videoId as string) ? { videoId: videoId as string, valid: true } : { valid: false }
}

router.post('/ended', (req, res) => {
  const { videoId, valid } = readVideoId(req.body)
  if (!valid) return fail(res, 'a valid videoId is required', 'INVALID_VIDEO_ID', 400)

  const applied = endCurrent(videoId)
  ok(res, { ...getState(), ...(applied ? {} : { ignored: true }) })
})

router.post('/skip', (_req, res) => {
  skipCurrent()
  const state = getState()
  ok<PlayerActionResponse>(res, { ...state, message: buildSkipMessage(state) })
})

router.post('/pause', (_req, res) => {
  setPaused(true)
  ok<PlayerActionResponse>(res, { ...getState(), message: translateWithFallback('chat.paused', undefined, 'Player paused') })
})

router.post('/resume', (_req, res) => {
  setPaused(false)
  ok<PlayerActionResponse>(res, { ...getState(), message: translateWithFallback('chat.resumed', undefined, 'Playback resumed') })
})

router.post('/report-failure', reportFailureLimiter.middleware, (req, res) => {
  const { videoId, valid } = readVideoId(req.body)
  if (!valid) return fail(res, 'a valid videoId is required', 'INVALID_VIDEO_ID', 400)

  const errorCode = typeof req.body?.errorCode === 'number' ? req.body.errorCode : undefined
  const applied = reportPlaybackFailure(errorCode, videoId)
  const state = getState()

  if (!applied) return ok(res, { ...state, ignored: true })
  ok<PlayerActionResponse>(res, { ...state, message: buildSkipMessage(state) })
})
