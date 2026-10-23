import { scrollToActiveFallback } from './fallback.js'
import { setClass, show } from '../shared.js'

let activeTab = 'dashboard'
let activeSection = 'queue'

// the watcher reads again whatever the page that just became shown needs; the panel registers it here (index.js).
// Returns the unsubscribe: a later registration replaces an earlier one, and the stop of the panel takes its own off
let refreshShown = () => {}
export const onTabShown = (callback) => {
  refreshShown = callback
  return () => {
    if (refreshShown === callback) refreshShown = () => {}
  }
}

export const isDashboardActive = () => activeTab === 'dashboard'
export const isPlaylistsActive = () => activeTab === 'playlists'
export const isSettingsActive = () => activeTab === 'settings'

export function switchPageTab(tabName) {
  if (activeTab === tabName) return

  activeTab = tabName
  document.querySelectorAll('.page-tab').forEach((el) => {
    setClass(el, 'active', el.dataset.pageTab === tabName)
  })
  document.querySelectorAll('.page-tab-btn').forEach((el) => {
    setClass(el, 'active', el.dataset.pageTabTarget === tabName)
  })

  // nothing was read while this page was hidden: whatever it shows is read again
  refreshShown()
}

export function switchSection(sectionName) {
  if (activeSection === sectionName) return

  activeSection = sectionName
  const wrapper = document.querySelector('.section-tabs-wrapper')
  if (!wrapper) return

  wrapper.querySelectorAll('.section-tab').forEach((el) => {
    show(el, el.dataset.section === sectionName)
  })
  // the list could not be scrolled while it was hidden
  if (sectionName === 'playlist') scrollToActiveFallback()
  wrapper.querySelectorAll('.section-tab-btn').forEach((el) => {
    setClass(el, 'active', el.dataset.sectionTarget === sectionName)
  })
}
