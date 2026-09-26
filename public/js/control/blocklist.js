import { api } from './api.js'
import { state, renderStats } from './state.js'
import { views } from './views/index.js'
import { run } from './run.js'
import { t } from '../i18n.js'
import { toastSuccess } from './toast.js'
import { refreshState } from './queue.js'
import { refreshFallbackState } from './fallback.js'

export function loadBlocklist() {
  return run('loading blocklist', async () => {
    const data = await api.getBlocklist()
    state.blocklist = data.entries ?? []
    views.blocklist.render(state.blocklist)
    renderStats()
  })
}

export function blockTrack(videoId, title) {
  return run('blocking track', async () => {
    await api.blockTrack(videoId, title)
    await loadBlocklist()
    await Promise.all([refreshState(true), refreshFallbackState(true)])
    toastSuccess(t('toast.trackBlocked'))
  })
}

export function unblockTrack(videoId) {
  return run('unblocking track', async () => {
    await api.unblockTrack(videoId)
    await loadBlocklist()
    await Promise.all([refreshState(true), refreshFallbackState(true)])
    toastSuccess(t('toast.trackUnblocked'))
  })
}

export const blocklistActions = {
  'block-track': (element) => blockTrack(element.dataset.videoId, element.dataset.title),
  'unblock-track': (element) => unblockTrack(element.dataset.videoId)
}
