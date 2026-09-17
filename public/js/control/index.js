import { api } from './api.js'
import { dom, log } from './state.js'
import { initI18n } from '../i18n.js'
import './player.js'
import { bindEvents } from './events.js'
import { refreshState } from './queue.js'
import { refreshFallbackState } from './fallback.js'
import { loadActivity } from './activity.js'
import { loadBlocklist } from './blocklist.js'
import { loadPlaylists } from './playlists.js'
import { loadSecrets, loadConfig, loadOverlaySettings, loadNetworkInfo } from './settings.js'
import { activeTab } from './tabs.js'

async function init() {
  let locale
  try {
    ;({ locale } = await api.getLocale())
  } catch (error) {
    log('Failed to fetch locale, falling back to default:', error)
  }

  await initI18n(locale)
  if (dom.localeSelect) dom.localeSelect.value = locale ?? dom.localeSelect.value

  bindEvents()

  await Promise.allSettled([
    loadSecrets(),
    loadConfig(),
    loadOverlaySettings(),
    loadNetworkInfo(),
    loadActivity(),
    loadBlocklist(),
    loadPlaylists(),
    refreshState(),
    refreshFallbackState()
  ])

  setInterval(() => {
    if (activeTab === 'dashboard') refreshState(true)
  }, 2000)

  setInterval(() => {
    if (activeTab === 'dashboard') refreshFallbackState(true)
  }, 30000)

  setInterval(() => {
    if (activeTab === 'dashboard') loadActivity(true)
  }, 5000)

  log('Control panel initialized')
}

init()
