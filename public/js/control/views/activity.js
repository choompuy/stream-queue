import { escapeHtml, translateErrorCode, youtubeThumbnail } from '../../shared.js'
import { t } from '../../i18n.js'
import { dom } from '../state.js'
import { formatRelativeTime } from '../ui.js'
import { blockTrackItem, createListView, row, rowMenu, statusPill } from './primitives.js'

const STATUS_LABEL_KEYS = {
  accepted: 'activity.accepted',
  failed: 'activity.failed',
  rejected: 'activity.rejected'
}

export const activityView = createListView(dom.activityListWrapper, {
  getKey: (items) => {
    // relative timestamps ("5 minutes ago") must be re-rendered as time passes
    const minute = Math.floor(Date.now() / 60000)
    return [
      minute,
      ...items.map((entry) => [entry.at, entry.status, entry.title, entry.videoId, entry.query, entry.requestedBy, entry.reasonCode].join(':'))
    ].join('|')
  },
  renderRow: (entry) => {
    const title = entry.title || entry.query

    return row({
      thumbnail: entry.videoId ? youtubeThumbnail(entry.videoId) : '',
      title,
      subtitle: translateErrorCode(t, entry.reasonCode, entry.reasonParams),
      extra: `
        <div class="text-sm text-secondary">
          ${formatRelativeTime(entry.at)}
        </div>
        <div class="text-sm text-green">
          @${escapeHtml(entry.requestedBy)}
        </div>
        ${statusPill(t(STATUS_LABEL_KEYS[entry.status] ?? STATUS_LABEL_KEYS.rejected), entry.status)}
      `,
      actions: entry.videoId ? rowMenu([blockTrackItem(entry.videoId, title)]) : ''
    })
  }
})
