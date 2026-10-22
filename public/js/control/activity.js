import { api } from './api.js'
import { state, on } from './state.js'
import { dom } from './dom.js'
import { views } from './views/index.js'
import { t } from '../i18n.js'
import { setText } from '../shared.js'

function renderActivity() {
  views.activity.render(state.activity)
  setText(dom.activityCount, t('activity.requests', { count: state.activity.length }))
}

on('activity', renderActivity)

// The activity topic: the data is written to the store and the drawings are its subscribers; the watcher logs a read
// that fails. A read is never a toast: what is worth telling is told by the notices of the server
export function readActivity() {
  return api.getActivity().then((data) => {
    state.activity = data.entries
  })
}

export async function clearActivity() {
  const data = await api.clearActivity()
  state.activity = data.entries
  views.activity.invalidate()
}

export const activityActions = {
  'clear-activity': clearActivity
}
