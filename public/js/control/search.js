import { api } from './api.js'
import { dom } from './state.js'
import { views } from './views/index.js'
import { run } from './run.js'
import { refreshState } from './queue.js'
import { loadActivity } from './activity.js'
import { t } from '../i18n.js'
import { toastSuccess } from './toast.js'
import { show } from '../shared.js'

const YOUTUBE_URL_HINT = /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com|youtube-nocookie\.com|youtu\.be)\//

let searching = false

export function clearSearchResults() {
  views.search.clear()
  if (dom.searchInput) dom.searchInput.value = ''
  show(dom.searchListWrapper, false)
}

export async function search() {
  const query = dom.searchInput?.value.trim()
  if (!query) return

  if (searching) return
  searching = true

  await run(
    'searching',
    async () => {
      if (YOUTUBE_URL_HINT.test(query)) {
        await addSong(query)
        return
      }

      const data = await api.search(query)
      views.search.render(data.results)
      show(dom.searchListWrapper)
    },
    { button: dom.searchBtn }
  ).finally(() => {
    searching = false
  })
}

export function addSong(query) {
  return run(
    'adding song',
    async () => {
      const data = await api.requestSong(query)
      await refreshState()
      await loadActivity()
      toastSuccess(
        data.started
          ? t('toast.nowPlaying', { title: data.song.title })
          : t('toast.addedToQueue', { title: data.song.title, position: data.position })
      )
    },
    { onError: () => loadActivity() }
  )
}

export const searchActions = {
  search,
  'search-clear': clearSearchResults,
  'search-add': (element) => addSong(`https://www.youtube.com/watch?v=${element.dataset.videoId}`)
}
