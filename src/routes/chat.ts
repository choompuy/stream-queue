import express from 'express'
import { ok } from '../http.js'
import { buildNowPlayingMessage, buildQueueMessage } from '../chat-replies.js'
import { getState } from '../player.js'
import { getSettings } from '../settings.js'

export const router = express.Router()

router.get('/now-playing', (_req, res) => {
  const state = getState()
  const locale = getSettings().locale
  ok(res, { message: buildNowPlayingMessage(state, locale) })
})

router.get('/queue', (_req, res) => {
  const state = getState()
  const locale = getSettings().locale
  ok(res, { message: buildQueueMessage(state, locale) })
})
