import { api } from './api.js'
import { state } from './state.js'
import { dom } from './dom.js'
import { renderStats } from './stats.js'
import { views } from './views/index.js'
import { run } from './run.js'
import { renderCurrent, renderNext, renderPlayPause, syncPlayer } from './player.js'
import { t } from '../i18n.js'
import { toastSuccess } from './toast.js'
import { setText } from '../shared.js'

// Every request gets a number: an answer that arrives after a newer request was sent describes an older state and is dropped
let stateRequestId = 0

export function refreshState(silent = false) {
  return run(
    'fetching state',
    async () => {
      const requestId = ++stateRequestId
      const nextState = await api.getState()
      if (requestId !== stateRequestId) return

      state.current = nextState.current
      state.queue = nextState.queue
      state.isPaused = nextState.isPaused
      state.nextTrack = nextState.nextTrack
      renderState()
    },
    { silent }
  )
}

export function renderState() {
  renderCurrent()
  renderNext()
  renderQueue()
  renderPlayPause()
  renderStats()
  syncPlayer()
}

export function renderQueue() {
  const maxQueueSize = state.config?.maxQueueSize ?? 0
  setText(dom.queueCount, `${state.queue.length}/${maxQueueSize}`)
  setText(dom.tabQueueCount, state.queue.length)

  views.queue.render(state.queue)
}

export async function removeFromQueue(videoId) {
  await api.removeFromQueue(videoId)
  toastSuccess(t('toast.removedFromQueue'))
}

export function clearQueue() {
  return api.clearQueue()
}

export const queueActions = {
  'queue-remove': (element) => removeFromQueue(element.dataset.videoId),
  'clear-queue': clearQueue
}
