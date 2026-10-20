import { api } from './api.js'
import { state } from './state.js'
import { renderStats } from './stats.js'
import { views } from './views/index.js'
import { run } from './run.js'

function renderActivity() {
  views.activity.render(state.activity)
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
