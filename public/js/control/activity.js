import { api } from './api.js'
import { state, dom, renderStats } from './state.js'
import { views } from './views/index.js'
import { run } from './run.js'
import { t } from '../i18n.js'
import { toastInfo } from './toast.js'

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

export function loadActivity(silent = false) {
  return run(
    'loading activity',
    async () => {
      const data = await api.getActivity()
      const entries = data.entries ?? []
      notifyNewViewerRequests(entries)
      state.activity = entries
      renderActivity()
      renderStats()
    },
    { silent }
  )
}

export async function clearActivity() {
  if (!confirm(t('activity.clearConfirm'))) return

  await run(
    'clearing activity',
    async () => {
      const data = await api.clearActivity()
      state.activity = data.entries ?? []
      views.activity.invalidate()
      renderActivity()
      renderStats()
    },
    { button: dom.clearActivityBtn }
  )
}

export const activityActions = {
  'clear-activity': clearActivity
}
