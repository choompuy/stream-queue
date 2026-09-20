import express from 'express'
import { StateResponse, PlayerActionResponse, PlayerState } from '../types.js'
import { ok } from '../http.js'
import { translateWithFallback } from '../i18n.js'
import { setPaused } from '../queue.js'
import { getState, moveToNext, skipCurrent, reportPlaybackFailure } from '../player.js'

function buildSkipMessage(state: PlayerState): string {
  return state.current?.title
    ? translateWithFallback('chat.skippedNowPlaying', { title: state.current.title }, `Track skipped. Now playing: ${state.current.title}`)
    : translateWithFallback('chat.skipped', undefined, 'Track skipped')
}

export const router = express.Router()

router.post('/ended', (_req, res) => {
  moveToNext()
  ok<StateResponse>(res, getState())
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

router.post('/report-failure', (req, res) => {
  const errorCode = typeof req.body?.errorCode === 'number' ? req.body.errorCode : undefined
  reportPlaybackFailure(errorCode)
  const state = getState()
  ok<PlayerActionResponse>(res, { ...state, message: buildSkipMessage(state) })
})
