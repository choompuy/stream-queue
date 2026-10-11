import { dom } from './dom.js'
import { switchPageTab, switchSection } from './tabs.js'
import { dispatchAction } from './actions.js'
import { bindMenus } from './menu.js'
import { saveOverlaySettings, syncHideOverlayInfoAvailability, onIpChange, changeLocale } from './settings.js'
import { onTwitchRewardChange, stopTwitchPolling, bindTwitchFieldTracking, bindTwitchRewardFormEvents } from './twitch/index.js'
import { trackForm } from './form.js'
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

  // Enter in a field presses the button that the field names in data-submit, so the key does what a click does
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.dataset?.submit) document.getElementById(event.target.dataset.submit).click()
  })

  dom.showVideo.addEventListener('change', () => {
    syncHideOverlayInfoAvailability()
    saveOverlaySettings()
  })
  dom.hideOverlayInfo.addEventListener('change', saveOverlaySettings)
  dom.overlayOpacity.addEventListener('change', saveOverlaySettings)
  dom.badgePosition.addEventListener('change', saveOverlaySettings)
  dom.selectIp.addEventListener('change', onIpChange)
  dom.twitchRewardSelect.addEventListener('change', onTwitchRewardChange)
  window.addEventListener('pagehide', stopTwitchPolling)
  dom.localeSelect.addEventListener('change', (event) => changeLocale(event.target.value))

  const settingsInputs = [
    dom.secYoutubeKey,
    dom.showVideo,
    dom.hideOverlayInfo,
    dom.overlayOpacity,
    dom.badgePosition,
    dom.localeSelect
  ]

  settingsInputs.forEach((input) => {
    if (input) {
      input.addEventListener('input', () => setError(input, false))
      input.addEventListener('change', () => setError(input, false))
    }
  })

  trackForm(dom.botSettingsPanel)
  bindTwitchFieldTracking()
  bindTwitchRewardFormEvents()
}
