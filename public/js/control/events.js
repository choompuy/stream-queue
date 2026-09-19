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
import { clearActivity, setActivityFilter, blockTrack } from './activity.js'
import { unblockTrack } from './blocklist.js'
import { addPlaylist, activatePlaylist, deletePlaylist } from './playlists.js'
import { saveOverlaySettings, copyOverlayUrl, onIpChange, toggleQr, saveConfigSetting, changeLocale } from './settings.js'

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
  'activity-filter': (action) => setActivityFilter(action.dataset.filter),
  'block-track': (action) => blockTrack(action.dataset.videoId, action.dataset.title),
  'unblock-track': (action) => unblockTrack(action.dataset.videoId),
  'copy-overlay-url': copyOverlayUrl,
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

    const menuToggle = event.target.closest('[data-action="toggle-menu"]')
    if (menuToggle) {
      const dropdown = menuToggle.closest('.row-menu')?.querySelector('.row-menu-dropdown')
      const wasOpen = dropdown && !dropdown.classList.contains('hidden')
      closeAllMenus()
      if (dropdown && !wasOpen) dropdown.classList.remove('hidden')
      return
    }

    if (!event.target.closest('.row-menu')) closeAllMenus()

    const action = event.target.closest('[data-action]')
    if (!action) return

    ACTIONS[action.dataset.action]?.(action)
    closeAllMenus()
  })

  dom.searchInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') search()
  })

  dom.playlistUrlInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') addPlaylist()
  })

  dom.showVideo?.addEventListener('change', saveOverlaySettings)
  dom.badgePosition?.addEventListener('change', saveOverlaySettings)
  dom.selectIp?.addEventListener('change', onIpChange)
  dom.localeSelect?.addEventListener('change', (e) => changeLocale(e.target.value))
}

function closeAllMenus() {
  document.querySelectorAll('.row-menu-dropdown').forEach((el) => el.classList.add('hidden'))
}
