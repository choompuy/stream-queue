import { describeTrack } from '../../shared.js'
import { PLUS_ICON, PLAY_ICON } from '../../icons.js'
import { t } from '../../i18n.js'
import { dom } from '../dom.js'
import { blockTrackItem, createListView, dataAttributes, row, rowMenu, statusPill, unblockTrackItem } from './primitives.js'

export const fallbackView = createListView(dom.fallbackListWrapper, {
  rowKey: (track) => track.videoId,
  renderRow: (item, index) => {
    const track = describeTrack(item)

    return row({
      index: index + 1,
      className: item.isActive ? 'row-active' : '',
      attributes: dataAttributes({ videoId: item.videoId }),
      thumbnail: item.thumbnail,
      title: track.title,
      subtitle: track.channel,
      meta: track.duration,
      extra: item.isActive ? statusPill(t('fallback.playing'), 'info') : item.isBlocked ? statusPill(t('blocklist.blockedLabel'), 'rejected') : '',
      actions: item.isBlocked
        ? unblockTrackItem(item.videoId)
        : rowMenu([
            { action: 'fallback-enqueue', data: { videoId: item.videoId }, icon: PLUS_ICON, label: t('search.addToQueue') },
            { action: 'fallback-play', data: { videoId: item.videoId }, icon: PLAY_ICON, label: t('fallback.playNow') },
            blockTrackItem(item.videoId, item.title)
          ])
    })
  }
})
