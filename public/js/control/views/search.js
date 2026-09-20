import { escapeHtml, formatDuration } from '../../shared.js'
import { PLUS_ICON } from '../../icons.js'
import { t } from '../../i18n.js'
import { dom } from '../state.js'
import { createListView, row } from './primitives.js'

export const searchView = createListView(dom.searchListWrapper, {
  cache: false,
  renderRow: (song) =>
    row({
      thumbnail: song.thumbnail,
      title: song.title,
      subtitle: song.channelTitle,
      meta: formatDuration(song.duration),
      actions: `
        <button
          class="btn btn-sm btn-icon"
          data-action="search-add"
          data-video-id="${escapeHtml(song.videoId)}"
          title="${t('search.addToQueue')}"
        >
          ${PLUS_ICON()}
        </button>
      `
    })
})
