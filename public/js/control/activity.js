import { api } from './api.js'
import { state } from './state.js'
import { renderStats } from './stats.js'
import { views } from './views/index.js'
import { run } from './run.js'

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
      state.activity = data.entries
      renderActivity()
      renderStats()
    },
    { silent }
  )
}

export async function clearActivity() {
  await run(
    'clearing activity',
    async () => {
      const data = await api.clearActivity()
      state.activity = data.entries
      views.activity.invalidate()
      renderActivity()
      renderStats()
    }
  )
}

export const activityActions = {
  'clear-activity': clearActivity
}
