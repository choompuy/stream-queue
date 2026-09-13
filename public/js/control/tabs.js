import { refreshState } from './queue.js'
import { refreshFallbackState, scrollToActiveFallback } from './fallback.js'

export let activeTab = 'dashboard'
let activeSection = 'queue'

export function switchPageTab(tabName) {
  const wasDashboard = activeTab === 'dashboard'
  if (activeTab === tabName) return

  activeTab = tabName
  document.querySelectorAll('.page-tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.pageTab === tabName)
  })
  document.querySelectorAll('.btn-tab').forEach((el) => {
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

  wrapper.querySelectorAll('.section-panel').forEach((el) => {
    el.classList.toggle('hidden', el.dataset.section !== sectionName)
    if (el.dataset.section === 'jam') scrollToActiveFallback()
  })
  wrapper.querySelectorAll('.section-tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.sectionTarget === sectionName)
  })
}
