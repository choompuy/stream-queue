import { api } from './api.js'
import { dom, views, log } from './state.js'
import { withLoading } from './ui.js'
import { refreshState } from './queue.js'
import { loadActivity } from './activity.js'

const YOUTUBE_URL_HINT = /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com|youtube-nocookie\.com|youtu\.be)\//

let lastSearch = ''

export function clearSearchResults() {
  views.search.clear()
  dom.searchInput.value = ''
  dom.searchListWrapper.classList.add('hidden')
}

export async function search() {
  const query = dom.searchInput.value.trim()
  if (!query) return

  if (lastSearch === query) return

  await withLoading(dom.searchBtn, async () => {
    try {
      if (YOUTUBE_URL_HINT.test(query)) {
        await addSong(query)
        return
      }

      const data = await api.search(query)
      views.search.render(data.results)
      dom.searchListWrapper.classList.remove('hidden')
      lastSearch = query
    } catch (error) {
      log('Search error:', error)
    }
  })
}

export async function addSong(query) {
  try {
    await api.requestSong(query)
    await refreshState()
    await loadActivity()
  } catch (error) {
    log('Error adding song:', error)
    await loadActivity()
  }
}
