import { translateWithFallback } from './i18n.js'
import { getState } from './player.js'
import type { PlayerState } from './types.js'

const truncate = (s: string, max = 40) => {
  const chars = Array.from(s)
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : s
}

// "Now playing: X (requested by Y)" / "Nothing is playing right now" - shared by the HTTP chat endpoint and the Twitch chat module
export function buildNowPlayingMessage(): string {
  const state = getState()

  if (!state.current) {
    return translateWithFallback('chat.nothingPlaying', undefined, 'Nothing is playing right now')
  }

  const base = translateWithFallback(
    'chat.nowPlayingWithRequester',
    { title: state.current.title, requestedBy: state.current.requestedBy },
    `Now playing: ${state.current.title} (requested by ${state.current.requestedBy})`
  )
  const pausedSuffix = state.isPaused ? translateWithFallback('chat.pausedSuffix', undefined, ' (paused)') : ''
  return base + pausedSuffix
}

// "Track skipped. Now playing: X" / "Track skipped" - shared by the HTTP player route and the Twitch chat module
export function buildSkipMessage(state: PlayerState): string {
  return state.current?.title
    ? translateWithFallback('chat.skippedNowPlaying', { title: state.current.title }, `Track skipped. Now playing: ${state.current.title}`)
    : translateWithFallback('chat.skipped', undefined, 'Track skipped')
}

// "Queue [N]: 1. Title | 2. Title ... [+more]" / "The queue is empty" - shared by the HTTP chat endpoint and the Twitch chat module
export function buildQueueMessage(): string {
  const state = getState()

  if (state.queue.length === 0) {
    return translateWithFallback('chat.queueEmpty', undefined, 'The queue is empty')
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
  return base + more
}
