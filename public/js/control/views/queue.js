import { escapeHtml, formatDuration } from '../../shared.js'
import { DELETE_ICON } from '../../icons.js'
import { t } from '../../i18n.js'
import { dom } from '../state.js'
import { blockTrackItem, createListView, row, rowMenu, statusPill, unblockTrackItem } from './primitives.js'

export const queueView = createListView(dom.queueListWrapper, {
  getKey: (items) =>
    items.map((item) => [item.videoId, item.requestedBy, item.title, item.thumbnail, item.duration, item.isBlocked].join(':')).join('|'),
  renderRow: (item, index) =>
    row({
      index: index + 1,
      thumbnail: item.thumbnail,
      title: item.title,
      subtitle: item.channelTitle,
      extra: `
        ${item.isBlocked ? statusPill(t('blocklist.blockedLabel'), 'rejected') : ''}
        <span class="column-requested-by text-sm text-green truncate">
          @${escapeHtml(item.requestedBy)}
        </span>
      `,
      meta: formatDuration(item.duration),
      actions: item.isBlocked
        ? unblockTrackItem(item.videoId)
        : rowMenu([
            blockTrackItem(item.videoId, item.title),
            { action: 'queue-remove', data: { index }, icon: DELETE_ICON, label: t('queue.remove'), danger: true }
          ]),
      attributes: `data-queue-index="${index}"`
    })
})
