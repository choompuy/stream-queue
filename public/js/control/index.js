import { api } from './api.js'
import { dom } from './dom.js'
import { log } from './log.js'
import { initI18n } from '../i18n.js'
import './player.js'
import './stats.js'
import { run } from './run.js'
import { bindEvents } from './events.js'
import { watch } from '../watch.js'
import { readState } from './queue.js'
import { readFallback } from './fallback.js'
import { readActivity } from './activity.js'
import { readBlocklist } from './blocklist.js'
import { readPlaylists } from './playlists.js'
import { loadSecrets, loadNetworkInfo, applyOverlaySettings, readConfig } from './settings.js'
import { loadTwitchConfig, readTwitchStatus } from './twitch/index.js'
import { isDashboardActive, isPlaylistsActive, isSettingsActive, onTabShown } from './tabs.js'
import { showNotice } from './notices.js'
// What each topic reads again: a `read*` function (the one-time loads of the startup are `load*`). Only what the
// person looks at is read: the rest is read when it is shown again. A read writes what it learned to the store
// (state.js); the drawings are subscribers of the store
const TOPICS = {
  state: { read: readState, isShown: isDashboardActive },
  activity: { read: readActivity, isShown: isDashboardActive },
  fallback: { read: readFallback, isShown: isDashboardActive },
  blocklist: { read: readBlocklist, isShown: isDashboardActive },
  playlists: { read: readPlaylists, isShown: isPlaylistsActive },
  config: { read: readConfig, isShown: isSettingsActive },
  twitch: { read: readTwitchStatus, isShown: () => document.visibilityState === 'visible' }
}

// the net under the events: while they are down the panel reads everything, slowly, as it used to
const SAFETY_POLL_MS = 10000

/**
 * Starts the control panel on the page that is open. Nothing runs on import, so the panel can be started by a test.
 * Returns `stop`, which closes the events and the safety net.
 */
export async function startControlPanel() {
  bindEvents()

  // one read of the settings for the locale and the controls of the settings form
  const settings = await run('fetching settings', () => api.getSettings(), { silent: true })
  await initI18n(settings?.locale)
  dom.localeSelect.value = settings?.locale ?? dom.localeSelect.value
  applyOverlaySettings(settings)

  // what the topics need to know before their first read: the Twitch topic asks only once the client id is known to be
  // configured, and its rewards are only asked for once the config of the integration is in the form
  await Promise.allSettled([loadSecrets(), loadNetworkInfo(), loadTwitchConfig()])

  const watcher = watch(TOPICS, {
    // the first read of every topic that is shown now; the first open of the connection announces nothing on top of it
    readNow: true,
    onNotice: showNotice,
    safetyMs: SAFETY_POLL_MS
  })

  // a page that was hidden heard nothing (the browser may even have paused it): what it shows now is read again,
  // and so is whatever is shown on every page
  const refreshShown = () => {
    if (document.visibilityState !== 'visible') return

    watcher.refreshAll()
    // the addresses of the machine change while the panel is open (DHCP, a VPN): the chooser of the panel's
    // address reads them again when the settings are looked at
    if (isSettingsActive()) loadNetworkInfo({ silent: true })
  }
  const offTabShown = onTabShown(refreshShown)
  document.addEventListener('visibilitychange', refreshShown)

  const stop = () => {
    watcher.close()
    offTabShown()
    document.removeEventListener('visibilitychange', refreshShown)
    window.removeEventListener('pagehide', stop)
  }
  window.addEventListener('pagehide', stop)

  log('Control panel initialized')

  return { stop }
}
