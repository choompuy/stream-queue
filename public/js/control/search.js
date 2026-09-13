import { api } from './api.js'
import { dom, views, log } from './state.js'
import { withLoading } from './ui.js'
import { refreshState } from './queue.js'
import { loadActivity } from './activity.js'

const YOUTUBE_URL_HINT = /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com|youtube-nocookie\.com|youtu\.be)\//

let lastSearch = ''

export function showSearchError(message) {
  dom.searchError.textContent = message
  dom.searchError.classList.remove('hidden')
}

export function clearSearchResults() {
  views.search.clear()
  dom.searchInput.value = ''
  dom.searchListWrapper.classList.add('hidden')
  dom.searchError.classList.add('hidden')
}

export async function search() {
  const query = dom.searchInput.value.trim()
  if (!query) return

  if (lastSearch === query) return
  lastSearch = query

  await withLoading(dom.searchBtn, async () => {
    try {
      if (YOUTUBE_URL_HINT.test(query)) {
        await addSong(query)
        return
      }

      const data = await api.search(query)
      views.search.render(data.results)
      dom.searchListWrapper.classList.remove('hidden')
    } catch (error) {
      log('Search error:', error)
      showSearchError(error.message || 'Error searching')
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
    showSearchError(error.message || 'Error adding video')
    await loadActivity()
  }
}
