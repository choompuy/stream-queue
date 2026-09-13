import { api } from './api.js'
import { state, views, dom, log, renderStats } from './state.js'
import { withLoading } from './ui.js'

export async function loadActivity() {
  try {
    const data = await api.getActivity()
    state.activity = data.entries ?? []
    views.activity.render(state.activity)
    renderStats()
  } catch (error) {
    log('Error loading activity:', error)
  }
}

export async function clearActivity() {
  if (!confirm('Clear recent activity?')) return

  await withLoading(dom.clearActivityBtn, async () => {
    try {
      const data = await api.clearActivity()
      state.activity = data.entries ?? []
      views.activity.invalidate()
      views.activity.render(state.activity)
      renderStats()
    } catch (error) {
      log('Error clearing activity:', error)
    }
  })
}
