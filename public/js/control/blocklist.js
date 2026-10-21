import { api } from './api.js'
import { state } from './state.js'
import { renderStats } from './stats.js'
import { views } from './views/index.js'
import { run } from './run.js'
import { t } from '../i18n.js'
import { toastSuccess } from './toast.js'

export function loadBlocklist(silent = false) {
  return run(
    'loading blocklist',
    async () => {
      const data = await api.getBlocklist()
      state.blocklist = data.entries
      views.blocklist.render(state.blocklist)
      renderStats()
    },
    { silent }
  )
}

export async function blockTrack(videoId, title) {
  await api.blockTrack(videoId, title)
  toastSuccess(t('toast.trackBlocked'))
}

export async function unblockTrack(videoId) {
  await api.unblockTrack(videoId)
  toastSuccess(t('toast.trackUnblocked'))
}

export const blocklistActions = {
  'block-track': (element) => blockTrack(element.dataset.videoId, element.dataset.title),
  'unblock-track': (element) => unblockTrack(element.dataset.videoId)
}
