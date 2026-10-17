import express from 'express'
import { PlayerActionResponse } from '../types.js'
import { ok, fail } from '../http.js'
import { isValidVideoId } from '../youtube/url.js'
import { t } from '../i18n.js'
import { buildSkipMessage } from '../chat-replies.js'
import { setPaused } from '../queue.js'
import { getState, endCurrent, skipCurrent, reportPlaybackFailure } from '../player.js'
import { getSettings } from '../settings.js'

export const router = express.Router()

// `videoId` says which track the client is talking about; without it the report is taken to be about the current one
function readVideoId(body: unknown): { videoId?: string; valid: boolean } {
  const videoId = (body as { videoId?: unknown } | undefined)?.videoId
  if (videoId === undefined) return { valid: true }
  return isValidVideoId(videoId) ? { videoId, valid: true } : { valid: false }
}

router.post('/ended', (req, res) => {
  const { videoId, valid } = readVideoId(req.body)
  if (!valid) return fail(res, 'INVALID_VIDEO_ID', 400)

  const applied = endCurrent(videoId)
  ok(res, { ...getState(), ...(applied ? {} : { ignored: true }) })
})

router.post('/skip', (_req, res) => {
  skipCurrent()
  const state = getState()
  const locale = getSettings().locale
  ok<PlayerActionResponse>(res, { ...state, message: buildSkipMessage(state, locale) })
})

router.post('/pause', (_req, res) => {
  setPaused(true)
  const locale = getSettings().locale
  ok<PlayerActionResponse>(res, { ...getState(), message: t(locale, 'chat.paused') })
})

router.post('/resume', (_req, res) => {
  setPaused(false)
  const locale = getSettings().locale
  ok<PlayerActionResponse>(res, { ...getState(), message: t(locale, 'chat.resumed') })
})

router.post('/report-failure', (req, res) => {
  const { videoId, valid } = readVideoId(req.body)
  if (!valid) return fail(res, 'INVALID_VIDEO_ID', 400)

  const errorCode = typeof req.body?.errorCode === 'number' ? req.body.errorCode : undefined
  const applied = reportPlaybackFailure(errorCode, videoId)
  const state = getState()
  const locale = getSettings().locale

  if (!applied) return ok(res, { ...state, ignored: true })
  ok<PlayerActionResponse>(res, { ...state, message: buildSkipMessage(state, locale) })
})
