import { api } from './api.js'
import { dom, log } from './state.js'
import { initI18n } from '../i18n.js'
import './player.js'
import { bindEvents } from './events.js'
import { refreshState } from './queue.js'
import { refreshFallbackState } from './fallback.js'
import { loadPlaylists } from './playlists.js'
import { loadActivity } from './activity.js'
import { loadSecrets, loadConfig, loadPreviewSettings, loadNetworkInfo } from './settings.js'
import { activeTab } from './tabs.js'

async function init() {
  const { locale } = await api.getLocale()
  await initI18n(locale)
  if (dom.localeSelect) dom.localeSelect.value = locale

  bindEvents()

  await Promise.allSettled([
    loadSecrets(),
    loadConfig(),
    loadPreviewSettings(),
    loadNetworkInfo(),
    loadPlaylists(),
    loadActivity(),
    refreshState(),
    refreshFallbackState()
  ])

  setInterval(() => {
    if (activeTab === 'dashboard') refreshState()
  }, 2000)

  setInterval(() => {
    if (activeTab === 'dashboard') refreshFallbackState()
  }, 30000)

  setInterval(() => {
    if (activeTab === 'dashboard') loadActivity()
  }, 5000)

  log('Control panel initialized')
}

init()
