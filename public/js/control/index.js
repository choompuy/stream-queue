import { api } from './api.js'
import { log } from './state.js'
import { dom } from './dom.js'
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
import { loadTwitchSettings, loadTwitchConfig, loadTwitchSecrets, refreshTwitchHealth } from './twitch/index.js'
import { isDashboardActive } from './tabs.js'
import { setError } from '../shared.js'
import { connectEvents } from '../sse.js'

const FALLBACK_POLLING = [
  { run: () => refreshState(true), every: 10000 },
  { run: () => refreshFallbackState(true), every: 10000 },
  { run: () => loadActivity(true), every: 10000 },
  { run: refreshTwitchHealth, every: 10000 }
]

const dirtyTopics = new Set()

async function init() {
  const settings = await run('fetching settings', () => api.getSettings(), { silent: true })
  const locale = settings?.locale

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

  // SSE connection
  let sseConnection = null
  let fallbackPoller = null

  function handleSSEChange(topic) {
    if (!isDashboardActive()) {
      dirtyTopics.add(topic)
      return
    }

    switch (topic) {
      case 'state':
        refreshState(true)
        break
      case 'activity':
        loadActivity(true)
        break
      case 'fallback':
        refreshFallbackState(true)
        break
      case 'twitch':
        refreshTwitchHealth()
        break
    }
  }

  function handleSSEStatus(status) {
    if (status === 'open') {
      log('SSE connected')
      if (fallbackPoller) {
        fallbackPoller.stop()
        fallbackPoller = null
      }
    } else {
      log('SSE down, enabling fallback polling')
      if (!fallbackPoller) {
        fallbackPoller = createPoller(FALLBACK_POLLING, { shouldRun: isDashboardActive })
        fallbackPoller.start()
      }
    }
  }

  sseConnection = connectEvents({
    topics: ['state', 'activity', 'fallback', 'twitch'],
    onChange: handleSSEChange,
    onStatus: handleSSEStatus
  })

  // Re-sync dirty topics when tab becomes active
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && dirtyTopics.size > 0) {
      for (const topic of dirtyTopics) {
        handleSSEChange(topic)
      }
      dirtyTopics.clear()
    }
  })

  window.addEventListener('pagehide', () => {
    if (sseConnection) sseConnection.close()
    if (fallbackPoller) fallbackPoller.stop()
  })

  log('Control panel initialized')
}

init()
