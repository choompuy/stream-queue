import express from 'express'
import { ok } from '../router.js'
import { translateWithFallback } from '../../i18n.js'
import { getState } from '../../core/player/service.js'

const truncate = (s: string, max = 40) => {
  const chars = Array.from(s)
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : s
}

export const router = express.Router()

router.get('/now-playing', (_req, res) => {
  const state = getState()

  if (!state.current) {
    return ok(res, { message: translateWithFallback('chat.nothingPlaying', undefined, 'Nothing is playing right now') })
  }

  const base = translateWithFallback(
    'chat.nowPlayingWithRequester',
    { title: state.current.title, requestedBy: state.current.requestedBy },
    `Now playing: ${state.current.title} (requested by ${state.current.requestedBy})`
  )
  const pausedSuffix = state.isPaused ? translateWithFallback('chat.pausedSuffix', undefined, ' (paused)') : ''
  ok(res, { message: base + pausedSuffix })
})

router.get('/queue', (_req, res) => {
  const state = getState()

  if (state.queue.length === 0) {
    return ok(res, { message: translateWithFallback('chat.queueEmpty', undefined, 'The queue is empty') })
  }

  const maxShown = 4

  const list = state.queue
    .slice(0, maxShown)
    .map((item, i) => `${i + 1}. ${truncate(item.title)}`)
    .join(' | ')
  const base = translateWithFallback('chat.queueList', { count: state.queue.length, list }, `Queue [${state.queue.length}]: ${list}`)
  const more =
    state.queue.length > maxShown
      ? translateWithFallback('chat.queueMore', { count: state.queue.length - maxShown }, ` [+${state.queue.length - maxShown}]`)
      : ''
  ok(res, { message: base + more })
})
