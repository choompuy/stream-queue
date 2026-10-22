import { dom } from './dom.js'
import { switchPageTab, switchSection } from './tabs.js'
import { dispatchAction } from './actions.js'
import { closeAllMenus } from './menu.js'
import { saveOverlaySettings, onIpChange, changeLocale } from './settings.js'
import { onTwitchRewardChange, bindTwitchRewardFormEvents, bindTwitchFieldTracking } from './twitch/index.js'
import { trackForm } from './form.js'

// What a select or a panel names in data-on-change is what happens when it changes: one listener binds them all
const CHANGES = {
  'overlay-settings': (target) => {
    if (target.name) saveOverlaySettings()
  },
  'select-ip': () => onIpChange(),
  'twitch-reward': () => onTwitchRewardChange(),
  locale: (target) => changeLocale(target.value)
}

export function bindEvents() {
  // one listener for every click of the panel: what a click means is written on the element it hits
  document.addEventListener('click', (event) => {
    // a click outside a menu closes them all (a click on a menu's own toggle is the menu's to handle)
    if (!event.target.closest('[data-action="toggle-menu"]')) closeAllMenus()

    const pageTabButton = event.target.closest('[data-page-tab-target]')
    if (pageTabButton) return switchPageTab(pageTabButton.dataset.pageTabTarget)

    const sectionButton = event.target.closest('[data-section-target]')
    if (sectionButton) return switchSection(sectionButton.dataset.sectionTarget)

    const actionElement = event.target.closest('[data-action]')
    if (actionElement) dispatchAction(actionElement, event)
  })

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAllMenus({ restoreFocus: true })

    // Enter in a field presses the button that the field names in data-submit, so the key does what a click does.
    // An IME composition keeps its own Enter (it confirms the text), and a name that names no button does nothing
    if (event.key === 'Enter' && !event.isComposing && event.target.dataset?.submit) {
      document.getElementById(event.target.dataset.submit)?.click()
    }
  })

  // one listener for every select that names what it changes (and for the panel that saves itself as it changes)
  document.addEventListener('change', (event) => {
    const bound = event.target.closest?.('[data-on-change]')?.dataset.onChange
    CHANGES[bound]?.(event.target)
  })

  // typing marks the field it happens in
  trackForm(dom.overlaySettingsPanel)
  trackForm(dom.botSettingsPanel)
  bindTwitchFieldTracking()
  bindTwitchRewardFormEvents()
}
