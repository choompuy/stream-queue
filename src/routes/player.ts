import express from 'express'
import { PlayerActionResponse } from '../types.js'
import { ok } from '../http.js'
import { t } from '../i18n.js'
import { buildSkipMessage } from '../chat-replies.js'
import { getState, endCurrent, skipCurrent, reportPlaybackFailure, setPaused } from '../player.js'
import { getSettings } from '../settings.js'
import { checkVideoId } from '../validate.js'

export const router = express.Router()

// `videoId` says which track the client is talking about; without it the report is taken to be about the current one
function readVideoId(body: unknown): string | undefined {
  const videoId = (body as { videoId?: unknown } | undefined)?.videoId
  if (videoId === undefined) return undefined
  checkVideoId(videoId)
  return videoId
}

// `playId` says which play of that track the report is about; a number that is not one is ignored, not refused
function readPlayId(body: unknown): number | undefined {
  const playId = (body as { playId?: unknown } | undefined)?.playId
  return typeof playId === 'number' && Number.isInteger(playId) && playId > 0 ? playId : undefined
}

router.post('/ended', (req, res) => {
  const videoId = readVideoId(req.body)
  const playId = readPlayId(req.body)

  const applied = endCurrent(videoId, playId)
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
  const videoId = readVideoId(req.body)
  const playId = readPlayId(req.body)

  const errorCode = typeof req.body?.errorCode === 'number' ? req.body.errorCode : undefined
  const applied = reportPlaybackFailure(errorCode, videoId, playId)
  const state = getState()
  const locale = getSettings().locale

  if (!applied) return ok(res, { ...state, ignored: true })
  ok<PlayerActionResponse>(res, { ...state, message: buildSkipMessage(state, locale) })
})
