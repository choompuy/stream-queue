import { refreshState } from './queue.js'
import { refreshFallbackState, scrollToActiveFallback } from './fallback.js'
import { loadActivity } from './activity.js'
import { setClass, show } from '../shared.js'

export let activeTab = 'dashboard'
let activeSection = 'queue'

export const isDashboardActive = () => activeTab === 'dashboard'

export function switchPageTab(tabName) {
  const wasDashboard = activeTab === 'dashboard'
  if (activeTab === tabName) return

  activeTab = tabName
  document.querySelectorAll('.page-tab').forEach((el) => {
    setClass(el, 'active', el.dataset.pageTab === tabName)
  })
  document.querySelectorAll('.page-tab-btn').forEach((el) => {
    setClass(el, 'active', el.dataset.pageTabTarget === tabName)
  })

  if (!wasDashboard && tabName === 'dashboard') {
    // nothing was read while the dashboard was hidden
    refreshState()
    refreshFallbackState()
    loadActivity()
  }
}

export function switchSection(sectionName) {
  if (activeSection === sectionName) return

  activeSection = sectionName
  const wrapper = document.querySelector('.section-tabs-wrapper')
  if (!wrapper) return

  wrapper.querySelectorAll('.section-tab').forEach((el) => {
    show(el, el.dataset.section === sectionName)
    if (el.dataset.section === 'playlist') scrollToActiveFallback()
  })
  wrapper.querySelectorAll('.section-tab-btn').forEach((el) => {
    setClass(el, 'active', el.dataset.sectionTarget === sectionName)
  })
}
