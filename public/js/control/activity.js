import { api } from './api.js'
import { state } from './state.js'
import { dom } from './dom.js'
import { renderStats } from './stats.js'
import { views } from './views/index.js'
import { run } from './run.js'
import { t } from '../i18n.js'
import { setText } from '../shared.js'

function renderActivity() {
  views.activity.render(state.activity)
  setText(dom.activityCount, t('activity.requests', { count: state.activity.length }))
}

export function loadActivity(silent = false) {
  return run(
    'loading activity',
    async () => {
      const data = await api.getActivity()
      state.activity = data.entries
      renderActivity()
      renderStats()
    },
    { silent }
  )
}

export async function clearActivity() {
  const data = await api.clearActivity()
  state.activity = data.entries
  views.activity.invalidate()
  renderActivity()
  renderStats()
}

export const activityActions = {
  'clear-activity': clearActivity
}
