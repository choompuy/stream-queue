import { displayChannel, displayTitle, formatTrackDuration } from '../../shared.js'
import { DELETE_ICON } from '../../icons.js'
import { t, requesterName } from '../../i18n.js'
import { dom } from '../dom.js'
import { blockTrackItem, createListView, dataAttributes, html, row, rowMenu, statusPill, unblockTrackItem } from './primitives.js'

export const queueView = createListView(dom.queueListWrapper, {
  rowKey: (item) => item.videoId,
  renderRow: (item, index) =>
    row({
      index: index + 1,
      thumbnail: item.thumbnail,
      title: displayTitle(item.title),
      subtitle: displayChannel(item.channelTitle),
      extra: html`
        ${item.isBlocked ? statusPill(t('blocklist.blockedLabel'), 'rejected') : ''}
        <span class="column-requested-by text-sm text-green truncate">${requesterName(item)}</span>
      `,
      meta: formatTrackDuration(item.duration),
      actions: item.isBlocked
        ? unblockTrackItem(item.videoId)
        : rowMenu([
            blockTrackItem(item.videoId, item.title),
            { action: 'queue-remove', data: { videoId: item.videoId }, icon: DELETE_ICON, label: t('queue.remove'), danger: true }
          ]),
      attributes: dataAttributes({ videoId: item.videoId })
    })
})
