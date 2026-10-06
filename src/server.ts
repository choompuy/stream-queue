import express from 'express'
import cors from 'cors'
import path from 'node:path'

import { findAvailablePort } from './port.js'
import { getServerConfig, updateServerConfig } from './server-config.js'
import { getAppRoot, loadEnvFile } from './runtime.js'
import { initState } from './state-file.js'
import { runStartupTasks } from './startup.js'
import { errorHandler, ForbiddenOriginError } from './error-handler.js'
import { apiRouter } from './routes/index.js'
import { initializeTwitchIntegration } from './integrations/twitch/index.js'
import { getTwitchClientId } from './secrets.js'
import { createLogger, describeError, enableFileLogging, flushLogs } from './logger.js'
import { hostCheck } from './host-check.js'
import { installShutdownHandlers } from './shutdown.js'
import { requestSong, setPaused, detachChannelPointsRedemptions } from './queue.js'
import { getState, skipCurrent } from './player.js'
import { registerRedemptionHandler } from './finish.js'
import { translateWithFallback } from './i18n.js'

const app = express()
let PORT: number

const LAN_HOSTNAME_PATTERN = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.|fd[0-9a-f]{2}:|fe80:)/i
const PUBLIC_DIR = path.join(getAppRoot(), 'public')

app.use(hostCheck)
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true)

      try {
        const { hostname } = new URL(origin)
        const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1'
        const isLan = LAN_HOSTNAME_PATTERN.test(hostname)

        if (isLocalHost || isLan) return callback(null, true)
      } catch {
        // not a valid origin - fall through to rejection below
      }

      callback(new ForbiddenOriginError())
    }
  })
)
app.use(express.json({ limit: '50kb' }))
app.use(express.static(PUBLIC_DIR))

const log = createLogger('SERVER')

app.get('/overlay', (_req, res) => {
  res.sendFile('overlay.html', {
    root: PUBLIC_DIR
  })
})

app.use('/api', apiRouter)

app.use(errorHandler)

async function main() {
  loadEnvFile()
  enableFileLogging()
  installShutdownHandlers()

  // a stray rejected promise must not stop the music mid-stream: log it and carry on
  process.on('unhandledRejection', (reason) => {
    log.error(`Unhandled rejection: ${describeError(reason, true)}`)
  })

  initState()
  const twitchClientId = getTwitchClientId()

  if (twitchClientId) {
    initializeTwitchIntegration({
      clientId: twitchClientId
    }, {
      queue: {
        requestSong,
        setPaused,
        detachChannelPointsRedemptions
      },
      player: {
        getState,
        skipCurrent
      },
      registerRedemptionHandler,
      translate: (key, params, fallback) => translateWithFallback(key, params as Record<string, string | number> | undefined, fallback ?? '')
    })
  } else {
    log.warn('Twitch integration disabled: TWITCH_CLIENT_ID is not set')
  }

  const preferredPort = getServerConfig().port
  PORT = await findAvailablePort(preferredPort, 65535)

  if (PORT !== preferredPort) {
    // remembered, so the link does not change again on the next launch
    log.warn(`Port ${preferredPort} is busy, using ${PORT} instead. The overlay URL in OBS is now http://localhost:${PORT}/overlay.html`)
    updateServerConfig({ port: PORT })
  }

  const server = app.listen(PORT, () => {
    log.log(`Server running on http://localhost:${PORT}`)
    void runStartupTasks()
  })

  server.on('error', (error) => {
    log.error(`Fatal server error: ${error.message}`)
    void flushLogs().finally(() => process.exit(1))
  })
}

main().catch((error) => {
  log.error(`Fatal: ${describeError(error)}`)
  void flushLogs().finally(() => process.exit(1))
})
