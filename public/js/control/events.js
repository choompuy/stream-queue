import { CONFIG_FIELDS, dom } from './state.js'
import { switchPageTab, switchSection } from './tabs.js'
import { dispatchAction } from './actions.js'
import { bindMenus } from './menu.js'
import { search } from './search.js'
import { addPlaylist } from './playlists.js'
import { saveOverlaySettings, onIpChange, changeLocale } from './settings.js'
import { onTwitchRewardChange, stopTwitchPolling } from './twitch.js'
import { setError } from '../shared.js'

export function bindEvents() {
  bindMenus()

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

    const actionElement = event.target.closest('[data-action]')
    if (actionElement) dispatchAction(actionElement, event)
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
  dom.twitchRewardSelect?.addEventListener('change', onTwitchRewardChange)
  window.addEventListener('pagehide', stopTwitchPolling)
  dom.localeSelect?.addEventListener('change', (event) => changeLocale(event.target.value))

  const settingsInputs = [
    dom.cfgMinViews,
    dom.cfgMinDuration,
    dom.cfgMaxDuration,
    dom.cfgMaxQueue,
    dom.cfgMaxPerUser,
    dom.cfgRegionCode,
    dom.cfgAllowShorts,
    dom.cfgAllowLiveStreams,
    dom.secYoutubeKey,
    dom.showVideo,
    dom.badgePosition,
    dom.localeSelect
  ]

  settingsInputs.forEach((input) => {
    if (input) {
      input.addEventListener('input', () => setError(input, false))
      input.addEventListener('change', () => setError(input, false))
    }
  })

  const configFields = CONFIG_FIELDS.map((f) => dom[f.dom]).filter(Boolean)
  configFields.forEach((input) => {
    input.addEventListener('focus', () => setError(input, false))
  })
}
