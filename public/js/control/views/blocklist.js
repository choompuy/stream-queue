import { displayTitle, youtubeThumbnail } from '../../shared.js'
import { dom } from '../dom.js'
import { formatDateTime } from '../ui.js'
import { createListView, row, unblockTrackItem } from './primitives.js'

export const blocklistView = createListView(dom.blocklistListWrapper, {
  rowKey: (entry) => entry.videoId,
  renderRow: (entry) =>
    row({
      index: formatDateTime(entry.blockedAt, '\n'),
      thumbnail: youtubeThumbnail(entry.videoId),
      title: displayTitle(entry.title),
      actions: unblockTrackItem(entry.videoId)
    })
})
