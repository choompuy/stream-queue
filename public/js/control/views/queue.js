import { describeTrack } from '../../shared.js'
import { DELETE_ICON } from '../../icons.js'
import { t } from '../../i18n.js'
import { dom } from '../dom.js'
import { blockTrackItem, createListView, dataAttributes, html, row, rowMenu, statusPill, unblockTrackItem } from './primitives.js'

export const queueView = createListView(dom.queueListWrapper, {
  rowKey: (item) => item.videoId,
  renderRow: (item, index) => {
    const track = describeTrack(item)

    return row({
      index: index + 1,
      thumbnail: item.thumbnail,
      title: track.title,
      subtitle: track.channel,
      extra: html`
        ${item.isBlocked ? statusPill(t('blocklist.blockedLabel'), 'rejected') : ''}
        <span class="column-requested-by text-sm text-green truncate">${track.requester}</span>
      `,
      meta: track.duration,
      actions: item.isBlocked
        ? unblockTrackItem(item.videoId)
        : rowMenu([
            blockTrackItem(item.videoId, item.title),
            { action: 'queue-remove', data: { videoId: item.videoId }, icon: DELETE_ICON, label: t('queue.remove'), danger: true }
          ]),
      attributes: dataAttributes({ videoId: item.videoId })
    })
  }
})
