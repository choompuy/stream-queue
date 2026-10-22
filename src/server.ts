import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createApp, listenOnFreePort, getPublicDir } from './app.js'
import { getServerConfig, updateServerConfig } from './server-config.js'
import { loadEnvFile } from './runtime.js'
import { ensureDataDirectory } from './persist.js'
import { initState } from './state-file.js'
import { runStartupTasks } from './startup.js'
import { initializeTwitchIntegration, stop } from './integrations/twitch/index.js'
import { getTwitchClientId } from './env.js'
import { clearTwitchAuthorization } from './secrets.js'
import { createLogger, describeError, enableFileLogging } from './logger.js'
import { installShutdownHandlers, registerBackgroundStop, registerServerStop, shutdown } from './shutdown.js'
import { installDesktopNotices, reportStartupFailure, writeDesktopReadyLine } from './desktop-notice.js'
import { notify } from './state-events.js'

const app = createApp()
const log = createLogger('SERVER')

async function main() {
  installDesktopNotices()
  loadEnvFile()
  enableFileLogging()
  installShutdownHandlers()

  await ensureDataDirectory()
  checkPublicDir()

  initState()
  clearTwitchAuthorization()
  const twitchClientId = getTwitchClientId()

  if (twitchClientId) initializeTwitchIntegration({ clientId: twitchClientId })
  else log.warn('Twitch integration disabled: TWITCH_CLIENT_ID is not set')

  const preferredPort = getServerConfig().port
  const { server, port } = await listenOnFreePort(app, preferredPort)

  // the tray reads the port from this line instead of parsing the log text
  await writeDesktopReadyLine(port)

  // saved before the exit, a request accepted during the save would be lost after it
  registerServerStop(() => server.close())

  // the Twitch sockets stop before the save too: a reconnect racing it could change what is being saved
  registerBackgroundStop(() => {
    void stop()
  })

  if (port !== preferredPort) {
    // remembered, so the link does not change again on the next launch
    log.warn(`Port ${preferredPort} is busy, using ${port} instead. The overlay URL in OBS is now http://localhost:${port}/overlay`)
    updateServerConfig({ port: port })
    // the overlay link in OBS changed: the streamer must see it right away
    notify({ type: 'desktop', level: 'warn', code: 'PORT_CHANGED', params: { from: preferredPort, to: port } })
  }

  log.info(`Server running on http://localhost:${port}`)
  void runStartupTasks()

  server.on('error', (error) => {
    log.error(`Fatal server error: ${error.message}`)
    // one exit path: through shutdown(), so what changed since the last save is not lost
    void shutdown(1)
  })
}

// A missing interface folder is a broken deployment, not a runtime hiccup: the desktop user sees it at once. The
// server still starts, for the API and the overlay depend on it only through the panel
function checkPublicDir(): void {
  const publicDir = getPublicDir()

  if (!existsSync(join(publicDir, 'index.html'))) {
    log.error(`The interface files are missing: no index.html in ${publicDir}`)
    notify({ type: 'desktop', level: 'error', code: 'PUBLIC_DIR_MISSING', params: { dir: publicDir } })
  }
}

main().catch(async (error) => {
  log.error(`Fatal: ${describeError(error)}`)
  await reportStartupFailure(error)
  // one exit path: through shutdown(), so what changed since the last save is not lost
  void shutdown(1)
})
