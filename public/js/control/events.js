import { dom } from './state.js'
import { switchPageTab, switchSection } from './tabs.js'
import { playPauseCurrent, skipCurrent } from './player.js'
import { search, addSong, clearSearchResults } from './search.js'
import { removeFromQueue, clearQueue } from './queue.js'
import {
  playFallbackNow,
  enqueueFallbackTrack,
  refreshFallback,
  toggleFallbackShuffle,
  toggleFallbackRepeat,
  toggleFallbackEnabled
} from './fallback.js'
import { addPlaylist, activatePlaylist, deletePlaylist } from './playlists.js'
import { clearActivity } from './activity.js'
import { savePreviewSettings, copyPreviewUrl, onIpChange, toggleQr, saveConfigSetting } from './settings.js'

const ACTIONS = {
  'play-pause': playPauseCurrent,
  skip: skipCurrent,
  search: search,
  'search-clear': clearSearchResults,
  'clear-queue': clearQueue,
  'queue-remove': (action) => removeFromQueue(Number(action.dataset.index)),
  'search-add': (action) => addSong(`https://www.youtube.com/watch?v=${action.dataset.videoId}`),
  'fallback-refresh': refreshFallback,
  'fallback-shuffle': toggleFallbackShuffle,
  'fallback-repeat': toggleFallbackRepeat,
  'fallback-enabled': toggleFallbackEnabled,
  'fallback-play': (action) => playFallbackNow(action.dataset.videoId),
  'fallback-enqueue': (action) => enqueueFallbackTrack(action.dataset.videoId),
  'add-playlist': addPlaylist,
  'playlist-activate': (action) => activatePlaylist(action.dataset.id),
  'playlist-delete': (action) => deletePlaylist(action.dataset.id),
  'clear-activity': clearActivity,
  'copy-preview-url': copyPreviewUrl,
  'toggle-qr': toggleQr,
  'save-config': saveConfigSetting
}

export function bindEvents() {
  document.addEventListener('click', (event) => {
    const pageTabButton = event.target.closest('[data-page-tab-target]')
    if (pageTabButton) {
      switchPageTab(pageTabButton.dataset.pageTabTarget)
      return
    }

    const sectionButton = event.target.closest('[data-section-target]')
    if (sectionButton) {
      switchSection(sectionButton.dataset.sectionTarget)
      return
    }

    const action = event.target.closest('[data-action]')
    if (!action) return

    ACTIONS[action.dataset.action]?.(action)
  })

  dom.searchInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') search()
  })

  dom.playlistUrlInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') addPlaylist()
  })

  dom.showVideo?.addEventListener('change', savePreviewSettings)
  dom.badgePosition?.addEventListener('change', savePreviewSettings)
  dom.selectIp?.addEventListener('change', onIpChange)
}
