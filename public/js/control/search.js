import { api } from './api.js'
import { dom } from './dom.js'
import { views } from './views/index.js'
import { t } from '../i18n.js'
import { toastSuccess } from './toast.js'
import { show } from '../shared.js'

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com', 'youtu.be'])

// A link is one word that points at a page of YouTube. Words that only mention one ("lofi youtube.com/ mix") are a search
function isYouTubeLink(query) {
  if (/\s/.test(query)) return false

  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(query) ? query : `https://${query}`)
    return YOUTUBE_HOSTS.has(url.hostname) && url.pathname.length > 1
  } catch {
    return false
  }
}

// the number of the last search: an answer that comes after a newer search (or after the results were cleared) is dropped
let lastSearch = 0

export function clearSearchResults() {
  lastSearch++
  views.search.clear()
  dom.searchInput.value = ''
  show(dom.searchListWrapper, false)
}

export async function search() {
  const query = dom.searchInput.value.trim()
  if (!query) return

  const thisSearch = ++lastSearch

  if (isYouTubeLink(query)) {
    await requestSong(query)
    // the link is done with; what was typed meanwhile is not touched
    if (dom.searchInput.value.trim() === query) dom.searchInput.value = ''
    return
  }

  const data = await api.search(query)
  if (thisSearch !== lastSearch) return

  views.search.render(data.results)
  show(dom.searchListWrapper)
}

async function requestSong(query) {
  const data = await api.requestSong(query)
  toastSuccess(
    data.started ? t('toast.nowPlaying', { title: data.song.title }) : t('toast.addedToQueue', { title: data.song.title, position: data.position })
  )
}

export function addSong(query) {
  return requestSong(query)
}

export const searchActions = {
  search,
  'search-clear': clearSearchResults,
  'search-add': (element) => addSong(`https://www.youtube.com/watch?v=${element.dataset.videoId}`)
}
