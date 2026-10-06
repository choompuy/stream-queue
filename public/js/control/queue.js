import { api } from './api.js'
import { state } from './state.js'
import { dom } from './dom.js'
import { selectors } from './fields.js'
import { renderStats } from './views/stats.js'
import { views } from './views/index.js'
import { run } from './run.js'
import { renderCurrent, renderNext, renderPlayPause, syncPlayer } from './player.js'
import { refreshFallbackState } from './fallback.js'
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

      const trackChanged = state.current?.videoId !== nextState.current?.videoId
      state.current = nextState.current
      state.queue = nextState.queue ?? []
      state.isPaused = Boolean(nextState.isPaused)
      state.nextTrack = nextState.nextTrack ?? null
      renderState()

      if (trackChanged) await refreshFallbackState(silent)
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

  views.queue.render(selectors.markBlocked(state.queue))
}

export function removeFromQueue(videoId) {
  return run('removing from queue', async () => {
    await api.removeFromQueue(videoId)
    await refreshState()
    toastSuccess(t('toast.removedFromQueue'))
  })
}

export async function clearQueue() {
  if (!confirm(t('queue.clearConfirm'))) return

  await run(
    'clearing queue',
    async () => {
      await api.clearQueue()
      await refreshState()
    },
    { button: dom.clearQueueBtn }
  )
}

export const queueActions = {
  'queue-remove': (element) => removeFromQueue(element.dataset.videoId),
  'clear-queue': clearQueue
}
