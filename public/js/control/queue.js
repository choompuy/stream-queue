import { api } from './api.js'
import { state, dom, views, log, renderStats } from './state.js'
import { withLoading } from './ui.js'
import { renderCurrent, renderNext, renderPlayPause, syncPlayer } from './player.js'
import { refreshFallbackState } from './fallback.js'
import { t } from '../i18n.js'
import { toastSuccess } from './toast.js'

export async function refreshState(silent = false) {
  try {
    const nextState = await api.getState(silent)
    const trackChanged = state.current?.videoId !== nextState.current?.videoId
    state.current = nextState.current
    state.queue = nextState.queue ?? []
    state.isPaused = Boolean(nextState.isPaused)
    state.nextTrack = nextState.nextTrack ?? null
    renderState()

    if (trackChanged) await refreshFallbackState(silent)
  } catch (error) {
    log('Error fetching state:', error)
  }
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

  const blockedIds = new Set(state.blocklist.map((entry) => entry.videoId))
  views.queue.render(state.queue.map((item) => ({ ...item, isBlocked: blockedIds.has(item.videoId) })))
}

export async function removeFromQueue(index) {
  try {
    await api.removeFromQueue(index)
    await refreshState()
    toastSuccess(t('toast.removedFromQueue'))
  } catch (error) {
    log('Error removing from queue:', error)
  }
}

export async function clearQueue() {
  if (!confirm(t('queue.clearConfirm'))) return

  await withLoading(dom.clearQueueBtn, async () => {
    try {
      await api.clearQueue()
      await refreshState()
    } catch (error) {
      log('Error clearing queue:', error)
    }
  })
}
