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
import { loadSecrets, loadConfig, loadOverlaySettings, loadNetworkInfo } from './settings.js'
import { loadTwitchSettings, loadTwitchConfig, loadTwitchSecrets } from './twitch/index.js'
import { isDashboardActive } from './tabs.js'
import { setError } from '../shared.js'

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
    setError(dom.localeSelect, false)
    dom.localeSelect.value = locale ?? dom.localeSelect.value
  }

  bindEvents()

  const secretsLoaded = loadSecrets()
  const twitchSecretsLoaded = loadTwitchSecrets()

  await Promise.allSettled([
    secretsLoaded,
    twitchSecretsLoaded,
    secretsLoaded.then(() => loadConfig()),
    twitchSecretsLoaded.then(() => loadTwitchSettings()).then(() => loadTwitchConfig()),
    loadOverlaySettings(),
    loadNetworkInfo(),
    loadActivity(),
    loadBlocklist(),
    loadPlaylists(),
    refreshState(),
    refreshFallbackState()
  ])

  const poller = createPoller(POLLING, { shouldRun: isDashboardActive })
  poller.start()
  window.addEventListener('pagehide', poller.stop)

  log('Control panel initialized')
}

init()
