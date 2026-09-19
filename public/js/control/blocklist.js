import { api } from './api.js'
import { state, views, log, renderStats } from './state.js'
import { t } from '../i18n.js'
import { toastSuccess } from './toast.js'
import { refreshState } from './queue.js'

export async function loadBlocklist() {
  try {
    const data = await api.getBlocklist()
    state.blocklist = data.entries ?? []
    views.blocklist.render(state.blocklist)
    renderStats()
  } catch (error) {
    log('Error loading blocklist:', error)
  }
}

export async function unblockTrack(videoId) {
  try {
    await api.unblockTrack(videoId)
    await loadBlocklist()
    await refreshState(true)
    toastSuccess(t('toast.trackUnblocked'))
  } catch (error) {
    log('Error unblocking track:', error)
  }
}
