import { api } from './api.js'
import { dom } from './dom.js'
import { log } from './log.js'
import { initI18n } from '../i18n.js'
import './player.js'
import { run } from './run.js'
import { bindEvents } from './events.js'
import { createPoller } from './polling.js'
import { connectEvents, serialized } from '../sse.js'
import { refreshState } from './queue.js'
import { refreshFallbackState } from './fallback.js'
import { loadActivity } from './activity.js'
import { loadBlocklist } from './blocklist.js'
import { loadPlaylists } from './playlists.js'
import { loadSecrets, loadConfig, loadOverlaySettings, loadNetworkInfo } from './settings.js'
import { loadTwitchSettings, loadTwitchConfig, loadTwitchSecrets, refreshTwitchHealth } from './twitch/index.js'
import { isDashboardActive } from './tabs.js'
import { setError } from '../shared.js'

// What each topic reads again. Only what the person looks at is read: the rest is read when it is shown again
const TOPICS = {
  state: { read: () => refreshState(true), isShown: isDashboardActive },
  activity: { read: () => loadActivity(true), isShown: isDashboardActive },
  fallback: { read: () => refreshFallbackState(true), isShown: isDashboardActive },
  twitch: { read: () => refreshTwitchHealth(), isShown: () => document.visibilityState === 'visible' }
}

// one at a time per topic: a late answer must not overwrite a newer one
for (const topic of Object.values(TOPICS)) topic.read = serialized(topic.read)

const refreshTopic = (name) => (TOPICS[name].isShown() ? TOPICS[name].read() : undefined)

// the net under the events: while they are down the panel polls, slowly, as it used to
const SAFETY_POLL_MS = 10000

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

  await Promise.allSettled([secretsLoaded, twitchSecretsLoaded, loadOverlaySettings(), loadNetworkInfo()])
  await Promise.allSettled([secretsLoaded.then(() => loadConfig()), twitchSecretsLoaded.then(() => loadTwitchSettings())])
  await loadTwitchConfig()
  await Promise.allSettled([loadActivity(), loadBlocklist(), loadPlaylists(), refreshState(), refreshFallbackState()])

  const safetyNet = createPoller(
    Object.keys(TOPICS).map((name) => ({ run: () => refreshTopic(name), every: SAFETY_POLL_MS }))
  )

  const events = connectEvents({
    topics: Object.keys(TOPICS),
    onChange: refreshTopic,
    onStatus: (status) => {
      if (status === 'down') safetyNet.start()
      else safetyNet.stop()
    }
  })

  // a tab hidden for a while heard nothing (the browser may even have paused it): read the status again when it is back
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshTopic('twitch')
  })

  window.addEventListener('pagehide', () => {
    events.close()
    safetyNet.stop()
  })

  log('Control panel initialized')
}

init()
