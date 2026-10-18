import { dom } from './dom.js'
import { switchPageTab, switchSection } from './tabs.js'
import { dispatchAction } from './actions.js'
import { bindMenus } from './menu.js'
import { saveOverlaySettings, onIpChange, changeLocale } from './settings.js'
import { onTwitchRewardChange, bindTwitchFieldTracking, bindTwitchRewardFormEvents } from './twitch/index.js'
import { trackForm } from './form.js'

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

  // the overlay settings are saved as soon as one of them changes
  dom.overlaySettingsPanel.addEventListener('change', (event) => {
    if (event.target.name) saveOverlaySettings()
  })
  trackForm(dom.overlaySettingsPanel)
  dom.selectIp.addEventListener('change', onIpChange)
  dom.twitchRewardSelect.addEventListener('change', onTwitchRewardChange)
  dom.localeSelect.addEventListener('change', (event) => changeLocale(event.target.value))

  trackForm(dom.botSettingsPanel)
  bindTwitchFieldTracking()
  bindTwitchRewardFormEvents()
}
