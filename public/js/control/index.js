import { api } from './api.js'
import { dom, log } from './state.js'
import { initI18n } from '../i18n.js'
import './player.js'
import { run } from './run.js'
import { bindEvents } from './events.js'
import { createPoller } from './polling.js'
import { refreshState } from './queue.js'
import { refreshFallbackState } from './fallback.js'
import { loadActivity } from './activity.js'
import { loadBlocklist } from './blocklist.js'
import { loadPlaylists } from './playlists.js'
import { loadSecrets, loadConfig, loadOverlaySettings, loadNetworkInfo, loadTwitchSettings } from './settings.js'
import { isDashboardActive } from './tabs.js'

const POLLING = [
  { run: () => refreshState(true), every: 2000 },
  { run: () => refreshFallbackState(true), every: 30000 },
  { run: () => loadActivity(true), every: 5000 }
]

async function init() {
  const localeData = await run('fetching locale', () => api.getLocale(), { silent: true })
  const locale = localeData?.locale

  await initI18n(locale)
  if (dom.localeSelect) {
    dom.localeSelect.classList.remove('error')
    dom.localeSelect.value = locale ?? dom.localeSelect.value
  }

  bindEvents()

  const secretsLoaded = loadSecrets()

  await Promise.allSettled([
    secretsLoaded,
    secretsLoaded.then(() => loadConfig()).then(() => loadTwitchSettings()),
    loadOverlaySettings(),
    loadNetworkInfo(),
    loadActivity(),
    loadBlocklist(),
    loadPlaylists(),
    refreshState(),
    refreshFallbackState()
  ])

  createPoller(POLLING, { shouldRun: isDashboardActive }).start()

  log('Control panel initialized')
}

init()
