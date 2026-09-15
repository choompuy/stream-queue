import { api } from './api.js'
import { state, views, dom, log, renderStats } from './state.js'
import { withLoading } from './ui.js'
import { t } from '../i18n.js'

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

export async function loadActivity() {
  try {
    const data = await api.getActivity()
    state.activity = data.entries ?? []
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
