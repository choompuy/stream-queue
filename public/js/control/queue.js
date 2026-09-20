import { api } from './api.js'
import { state, dom, selectors, renderStats } from './state.js'
import { views } from './views/index.js'
import { run } from './run.js'
import { renderCurrent, renderNext, renderPlayPause, syncPlayer } from './player.js'
import { refreshFallbackState } from './fallback.js'
import { t } from '../i18n.js'
import { toastSuccess } from './toast.js'

export function refreshState(silent = false) {
  return run(
    'fetching state',
    async () => {
      const nextState = await api.getState()
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
  dom.queueCount.textContent = `${state.queue.length}/${maxQueueSize}`

  if (dom.tabQueueCount) dom.tabQueueCount.textContent = state.queue.length

  views.queue.render(selectors.markBlocked(state.queue))
}

export function removeFromQueue(index) {
  return run('removing from queue', async () => {
    await api.removeFromQueue(index)
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
  'queue-remove': (element) => removeFromQueue(Number(element.dataset.index)),
  'clear-queue': clearQueue
}
