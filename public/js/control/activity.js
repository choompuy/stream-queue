import { api } from './api.js'
import { state, views, dom, log, renderStats } from './state.js'
import { withLoading } from './ui.js'
import { t } from '../i18n.js'
import { toastInfo, toastSuccess } from './toast.js'
import { loadBlocklist } from './blocklist.js'

let knownActivityKeys = null

function activityKey(entry) {
  return `${entry.at}:${entry.videoId}:${entry.requestedBy}`
}

function notifyNewViewerRequests(entries) {
  if (!knownActivityKeys) {
    knownActivityKeys = new Set(entries.map(activityKey))
    return
  }

  const newOnes = entries.filter(
    (entry) => entry.status === 'accepted' && entry.requestedBy !== 'ControlPanel' && !knownActivityKeys.has(activityKey(entry))
  )

  knownActivityKeys = new Set(entries.map(activityKey))

  if (newOnes.length === 1) {
    toastInfo(t('toast.viewerRequest', { title: newOnes[0].title, user: newOnes[0].requestedBy }))
  } else if (newOnes.length > 1) {
    toastInfo(t('toast.viewerRequestsMany', { count: newOnes.length }))
  }
}

function renderActivity() {
  const filter = state.activityFilter
  const entries = filter === 'all' ? state.activity : state.activity.filter((entry) => entry.status === filter)
  views.activity.render(entries)
}

function updateFilterButtons(filter) {
  dom.activityFilterAllBtn?.classList.toggle('active', filter === 'all')
  dom.activityFilterAcceptedBtn?.classList.toggle('active', filter === 'accepted')
  dom.activityFilterRejectedBtn?.classList.toggle('active', filter === 'rejected')
}

export async function loadActivity(silent = false) {
  try {
    const data = await api.getActivity(silent)
    const entries = data.entries ?? []
    notifyNewViewerRequests(entries)
    state.activity = entries
    renderActivity()
    renderStats()
  } catch (error) {
    log('Error loading activity:', error)
  }
}

export function setActivityFilter(filter) {
  if (!['all', 'accepted', 'rejected'].includes(filter) || filter === state.activityFilter) return

  state.activityFilter = filter
  updateFilterButtons(filter)
  views.activity.invalidate()
  renderActivity()
}

export async function clearActivity() {
  if (!confirm(t('activity.clearConfirm'))) return

  await withLoading(dom.clearActivityBtn, async () => {
    try {
      const data = await api.clearActivity()
      state.activity = data.entries ?? []
      views.activity.invalidate()
      renderActivity()
      renderStats()
    } catch (error) {
      log('Error clearing activity:', error)
    }
  })
}

export async function blockTrack(videoId, title) {
  try {
    await api.blockTrack(videoId, title)
    await loadBlocklist()
    toastSuccess(t('toast.trackBlocked'))
  } catch (error) {
    log('Error blocking track:', error)
  }
}
