import { describeTrack } from '../../shared.js'
import { PLUS_ICON } from '../../icons.js'
import { t } from '../../i18n.js'
import { dom } from '../dom.js'
import { createListView, html, raw, row, statusPill } from './primitives.js'

export const searchView = createListView(dom.searchListWrapper, {
  rowKey: (song) => song.videoId,
  renderRow: (song) => {
    const track = describeTrack(song)

    return row({
      thumbnail: song.thumbnail,
      title: track.title,
      subtitle: track.channel,
      extra: song.isBlocked ? statusPill(t('blocklist.blockedLabel'), 'rejected') : '',
      meta: track.duration,
      actions: html`
        <button
          class="btn btn-sm btn-icon"
          data-action="search-add"
          data-video-id="${song.videoId}"
          title="${t('search.addToQueue')}"
        >
          ${raw(PLUS_ICON())}
        </button>
      `
    })
  }
})
