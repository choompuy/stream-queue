import { displayTitle, translateErrorCode, youtubeThumbnail } from '../../shared.js'
import { t } from '../../i18n.js'
import { dom } from '../dom.js'
import { formatDateTime } from '../ui.js'
import { blockTrackItem, createListView, html, row, rowMenu, statusPill } from './primitives.js'

const STATUS_LABEL_KEYS = {
  accepted: { key: 'activity.accepted', status: 'accepted' },
  failed: { key: 'activity.failed', status: 'rejected' },
  skipped: { key: 'activity.skipped', status: 'info' },
  rejected: { key: 'activity.rejected', status: 'rejected' }
}

export const activityView = createListView(dom.activityListWrapper, {
  rowKey: (entry) => `${entry.at}:${entry.videoId ?? ''}:${entry.query ?? ''}`,
  renderRow: (entry) => {
    const title = translateErrorCode(t, entry.reasonCode, entry.reasonParams) || displayTitle(entry.title)
    const status = STATUS_LABEL_KEYS[entry.status] ?? STATUS_LABEL_KEYS.rejected

    return row({
      index: formatDateTime(entry.at, '\n'),
      thumbnail: entry.videoId ? youtubeThumbnail(entry.videoId) : '',
      title,
      subtitle: entry.query,
      extra: html`
        ${statusPill(t(status.key), status.status)}
        <span class="column-requested-by text-sm text-green truncate">@${entry.requestedBy}</span>
      `,
      actions: entry.videoId ? rowMenu([blockTrackItem(entry.videoId, entry.title || entry.query)]) : html`<span class="btn-sm"></span>`
    })
  }
})
