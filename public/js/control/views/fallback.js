import { formatDuration } from '../../shared.js'
import { PLUS_ICON, PLAY_ICON } from '../../icons.js'
import { t } from '../../i18n.js'
import { dom } from '../state.js'
import { blockTrackItem, createListView, dataAttributes, row, rowMenu, statusPill, unblockTrackItem } from './primitives.js'

export const fallbackView = createListView(dom.fallbackListWrapper, {
  getKey: (items) => items.map((item) => `${item.videoId}:${item.isBlocked}:${item.isActive}`).join('|'),
  renderRow: (track, index) =>
    row({
      index: index + 1,
      className: track.isActive ? 'row-active' : '',
      attributes: dataAttributes({ videoId: track.videoId }).trim(),
      thumbnail: track.thumbnail,
      title: track.title,
      subtitle: track.channelTitle,
      meta: formatDuration(track.duration),
      extra: track.isActive
        ? statusPill(t('fallback.playing'), 'failed')
        : track.isBlocked
          ? statusPill(t('blocklist.blockedLabel'), 'rejected')
          : '',
      actions: track.isBlocked
        ? unblockTrackItem(track.videoId)
        : rowMenu([
            { action: 'fallback-enqueue', data: { videoId: track.videoId }, icon: PLUS_ICON, label: t('fallback.addToQueue') },
            { action: 'fallback-play', data: { videoId: track.videoId }, icon: PLAY_ICON, label: t('fallback.playNow') },
            blockTrackItem(track.videoId, track.title)
          ])
    })
})
