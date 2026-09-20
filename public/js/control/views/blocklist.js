import { escapeHtml, youtubeThumbnail } from '../../shared.js'
import { PLUS_ICON } from '../../icons.js'
import { t } from '../../i18n.js'
import { dom } from '../state.js'
import { formatRelativeTime } from '../ui.js'
import { createListView, row } from './primitives.js'

export const blocklistView = createListView(dom.blocklistListWrapper, {
  getKey: (items) => items.map((entry) => [entry.videoId, entry.title, entry.blockedAt].join(':')).join('|'),
  renderRow: (entry) =>
    row({
      thumbnail: youtubeThumbnail(entry.videoId),
      title: entry.title,
      subtitle: formatRelativeTime(entry.blockedAt),
      actions: `
        <button
          class="btn btn-sm btn-icon"
          data-action="unblock-track"
          data-video-id="${escapeHtml(entry.videoId)}"
          title="${t('blocklist.unblock')}"
        >
          ${PLUS_ICON()}
        </button>
      `
    })
})
