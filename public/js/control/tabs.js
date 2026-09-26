import { refreshState } from './queue.js'
import { refreshFallbackState, scrollToActiveFallback } from './fallback.js'

export let activeTab = 'dashboard'
let activeSection = 'queue'

export const isDashboardActive = () => activeTab === 'dashboard'

export function switchPageTab(tabName) {
  const wasDashboard = activeTab === 'dashboard'
  if (activeTab === tabName) return

  activeTab = tabName
  document.querySelectorAll('.page-tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.pageTab === tabName)
  })
  document.querySelectorAll('.page-tab-btn').forEach((el) => {
    el.classList.toggle('active', el.dataset.pageTabTarget === tabName)
  })

  if (!wasDashboard && tabName === 'dashboard') {
    refreshState()
    refreshFallbackState()
  }
}

export function switchSection(sectionName) {
  if (activeSection === sectionName) return

  activeSection = sectionName
  const wrapper = document.querySelector('.section-tabs-wrapper')
  if (!wrapper) return

  wrapper.querySelectorAll('.section-tab').forEach((el) => {
    el.classList.toggle('hidden', el.dataset.section !== sectionName)
    if (el.dataset.section === 'playlist') scrollToActiveFallback()
  })
  wrapper.querySelectorAll('.section-tab-btn').forEach((el) => {
    el.classList.toggle('active', el.dataset.sectionTarget === sectionName)
  })
}
