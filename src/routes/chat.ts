import express from 'express'
import { ok } from '../http.js'
import { buildNowPlayingMessage, buildQueueMessage } from '../chat-replies.js'

export const router = express.Router()

router.get('/now-playing', (_req, res) => {
  ok(res, { message: buildNowPlayingMessage() })
})

router.get('/queue', (_req, res) => {
  ok(res, { message: buildQueueMessage() })
})
