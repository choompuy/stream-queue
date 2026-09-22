import { youtubeThumbnail } from '../../shared.js'
import { dom } from '../state.js'
import { formatDateTime } from '../ui.js'
import { createListView, row, unblockTrackItem } from './primitives.js'

export const blocklistView = createListView(dom.blocklistListWrapper, {
  getKey: (items) => items.map((entry) => [entry.videoId, entry.title, entry.blockedAt].join(':')).join('|'),
  renderRow: (entry) =>
    row({
      index: formatDateTime(entry.blockedAt, '\n'),
      thumbnail: youtubeThumbnail(entry.videoId),
      title: entry.title,
      actions: unblockTrackItem(entry.videoId)
    })
})
