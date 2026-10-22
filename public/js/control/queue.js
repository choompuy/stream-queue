import { api } from './api.js'
import { state, on } from './state.js'
import { dom } from './dom.js'
import { views } from './views/index.js'
import { t } from '../i18n.js'
import { toastSuccess } from './toast.js'
import { setText } from '../shared.js'

// The state topic: the data is written to the store and the drawings are its subscribers (player.js, the queue below);
// the watcher logs a read that fails
export function readState() {
  return api.getState().then((nextState) => Object.assign(state, nextState))
}

function queueHeaderText(length, max) {
  if (max > 0) return t('queue.infoMax', { count: length, max })
  return length > 0 ? t('queue.info', { count: length }) : t('queue.empty')
}

// the counts follow the queue and the config together: the limit of the queue is a setting
export function renderQueue() {
  const maxQueueSize = state.config?.maxQueueSize ?? 0
  setText(dom.queueCount, queueHeaderText(state.queue.length, maxQueueSize))
  setText(dom.tabQueueCount, state.queue.length)

  views.queue.render(state.queue)
}

on(['queue', 'config'], renderQueue)

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
