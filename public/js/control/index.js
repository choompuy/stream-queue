import { api, onServerChange } from './api.js'
import { dom } from './dom.js'
import { log } from './log.js'
import { initI18n } from '../i18n.js'
import './player.js'
import { run } from './run.js'
import { bindEvents } from './events.js'
import { watch } from '../sse.js'
import { refreshState } from './queue.js'
import { refreshFallbackState } from './fallback.js'
import { loadActivity } from './activity.js'
import { loadBlocklist } from './blocklist.js'
import { loadPlaylists } from './playlists.js'
import { loadSecrets, loadConfig, loadOverlaySettings, loadNetworkInfo } from './settings.js'
import { loadTwitchSettings, loadTwitchConfig, loadTwitchSecrets, refreshTwitchStatus } from './twitch/index.js'
import { isDashboardActive, isPlaylistsActive } from './tabs.js'
import { showNotice } from './notices.js'
import { setError } from '../shared.js'

// What each topic reads again. Only what the person looks at is read: the rest is read when it is shown again
const TOPICS = {
  state: { read: () => refreshState(true), isShown: isDashboardActive },
  activity: { read: () => loadActivity(true), isShown: isDashboardActive },
  fallback: { read: () => refreshFallbackState(true), isShown: isDashboardActive },
  blocklist: { read: () => loadBlocklist(true), isShown: isDashboardActive },
  playlists: { read: () => loadPlaylists(true), isShown: isPlaylistsActive },
  twitch: { read: () => refreshTwitchStatus(), isShown: () => document.visibilityState === 'visible' }
}

// the net under the events: while they are down the panel reads everything, slowly, as it used to
const SAFETY_POLL_MS = 10000

/**
 * Starts the control panel on the page that is open. Nothing runs on import, so the panel can be started by a test.
 * Returns `stop`, which closes the events and the safety net.
 */
export async function startControlPanel() {
  const settings = await run('fetching settings', () => api.getSettings(), { silent: true })
  const locale = settings?.locale

  await initI18n(locale)
  setError(dom.localeSelect, false)
  dom.localeSelect.value = locale ?? dom.localeSelect.value

  bindEvents()

  const secretsLoaded = loadSecrets()
  const twitchSecretsLoaded = loadTwitchSecrets()

  await Promise.allSettled([secretsLoaded, twitchSecretsLoaded, loadOverlaySettings(), loadNetworkInfo()])
  await Promise.allSettled([secretsLoaded.then(() => loadConfig()), twitchSecretsLoaded.then(() => loadTwitchSettings())])
  await loadTwitchConfig()
  await Promise.allSettled([loadActivity(), loadBlocklist(), loadPlaylists(), refreshState(), refreshFallbackState()])

  const watcher = watch(TOPICS, { onNotice: showNotice, safetyMs: SAFETY_POLL_MS })

  // with the events open the server announces what a request changed; without them the panel reads at once
  onServerChange(() => {
    if (!watcher.isOpen()) watcher.refreshAll()
  })

  // a tab hidden for a while heard nothing (the browser may even have paused it): read the status again when it is back
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') watcher.refresh('twitch')
  }
  document.addEventListener('visibilitychange', onVisibilityChange)

  const stop = () => {
    watcher.close()
    onServerChange(() => {})
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pagehide', stop)
  }
  window.addEventListener('pagehide', stop)

  log('Control panel initialized')

  return { stop }
}
