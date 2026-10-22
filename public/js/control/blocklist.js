import { api } from './api.js'
import { state, on } from './state.js'
import { views } from './views/index.js'
import { t } from '../i18n.js'
import { toastSuccess } from './toast.js'

on('blocklist', () => views.blocklist.render(state.blocklist))

// The blocklist topic: the data is written to the store and the drawing is a subscriber; the watcher logs a read that fails
export function readBlocklist() {
  return api.getBlocklist().then((data) => {
    state.blocklist = data.entries
  })
}

export async function blockTrack(videoId, title) {
  await api.blockTrack(videoId, title)
  toastSuccess(t('toast.trackBlocked'))
}

export async function unblockTrack(videoId) {
  await api.unblockTrack(videoId)
  toastSuccess(t('toast.trackUnblocked'))
}

export const blocklistActions = {
  'block-track': (element) => blockTrack(element.dataset.videoId, element.dataset.title),
  'unblock-track': (element) => unblockTrack(element.dataset.videoId)
}
