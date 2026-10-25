import { scrollToActiveFallback } from './fallback.js'
import { show } from '../shared.js'

let activeTab = 'dashboard'
let activeSection = 'queue'

// the tab someone leaves the page on is the one they come back to
const REMEMBERED_TAB = 'streamqueue:tab'
const REMEMBERED_SECTION = 'streamqueue:section'

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
  remember(REMEMBERED_TAB, tabName)

  document.querySelectorAll('.page-tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.pageTab === tabName)
  })
  document.querySelectorAll('.page-tab-btn').forEach((el) => {
    const selected = el.dataset.pageTabTarget === tabName
    el.classList.toggle('active', selected)
    el.setAttribute('aria-selected', String(selected))
  })

  // nothing was read while this page was hidden: whatever it shows is read again
  refreshShown()
}

export function switchSection(sectionName) {
  if (activeSection === sectionName) return

  activeSection = sectionName
  remember(REMEMBERED_SECTION, sectionName)

  const wrapper = document.querySelector('.section-tabs-wrapper')
  if (!wrapper) return

  wrapper.querySelectorAll('.section-tab').forEach((el) => {
    show(el, el.dataset.section === sectionName)
  })
  // the list could not be scrolled while it was hidden
  if (sectionName === 'playlist') scrollToActiveFallback()
  wrapper.querySelectorAll('.section-tab-btn').forEach((el) => {
    const selected = el.dataset.sectionTarget === sectionName
    el.classList.toggle('active', selected)
    el.setAttribute('aria-selected', String(selected))
  })
}

// what was open when the page was closed opens again (a wrong remembered name is simply ignored). A browser that
// refuses to remember (a private window) or a page without storage starts where it always did
const remember = (key, value) => {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // nothing is remembered then
  }
}

const remembered = (key, valid) => {
  try {
    const value = window.localStorage.getItem(key)
    return valid.includes(value) ? value : null
  } catch {
    return null
  }
}

const savedTab = remembered(REMEMBERED_TAB, ['dashboard', 'playlists', 'settings'])
if (savedTab) switchPageTab(savedTab)

const savedSection = remembered(REMEMBERED_SECTION, ['queue', 'playlist', 'activity', 'blocklist'])
if (savedSection) switchSection(savedSection)
