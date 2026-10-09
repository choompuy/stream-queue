import { escapeHtml, translateErrorCode, youtubeThumbnail } from '../../shared.js'
import { t } from '../../i18n.js'
import { dom } from '../dom.js'
import { formatDateTime } from '../ui.js'
import { blockTrackItem, createListView, row, rowMenu, statusPill } from './primitives.js'

const STATUS_LABEL_KEYS = {
  accepted: { key: 'activity.accepted', status: 'accepted' },
  failed: { key: 'activity.failed', status: 'rejected' },
  skipped: { key: 'activity.skipped', status: 'info' },
  rejected: { key: 'activity.rejected', status: 'rejected' }
}

export const activityView = createListView(dom.activityListWrapper, {
  getKey: (items) => {
    return [
      ...items.map((entry) => [entry.at, entry.status, entry.title, entry.videoId, entry.query, entry.requestedBy, entry.reasonCode].join(':'))
    ].join('|')
  },
  renderRow: (entry) => {
    const title = entry.title || entry.query
    const status = STATUS_LABEL_KEYS[entry.status] ?? STATUS_LABEL_KEYS.rejected

    return row({
      index: formatDateTime(entry.at, '\n'),
      thumbnail: entry.videoId ? youtubeThumbnail(entry.videoId) : '',
      title,
      subtitle: translateErrorCode(t, entry.reasonCode, entry.reasonParams),
      extra: `
        ${statusPill(t(status.key), status.status)}
        <span class="column-requested-by text-sm text-green truncate">
          @${escapeHtml(entry.requestedBy)}
        </span>
      `,
      actions: entry.videoId ? rowMenu([blockTrackItem(entry.videoId, title)]) : '<span class="btn-sm"></span>'
    })
  }
})
