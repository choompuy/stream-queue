import express from 'express'
import path from 'node:path'

import { getServerConfig, updateServerConfig } from './server-config.js'
import { getAppRoot, loadEnvFile } from './runtime.js'
import { initState } from './state-file.js'
import { runStartupTasks } from './startup.js'
import { errorHandler } from './error-handler.js'
import { apiRouter } from './routes/index.js'
import { initializeTwitchIntegration } from './integrations/twitch/index.js'
import { getTwitchClientId } from './secrets.js'
import { createLogger, describeError, enableFileLogging, flushLogs } from './logger.js'
import { hostCheck } from './host-check.js'
import { installShutdownHandlers } from './shutdown.js'
import type { Server } from 'node:http'

async function listenOnFreePort(start: number): Promise<{ server: Server; port: number }> {
  for (let port = start; port < start + 100; port++) {
    try {
      const server = await new Promise<Server>((resolve, reject) => {
        const candidate = app.listen(port)
        candidate.once('listening', () => resolve(candidate))
        candidate.once('error', reject)
      })
      return { server, port }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error
    }
  }
  throw new Error(`No free port in ${start}-${start + 99}`)
}

const app = express()

const PUBLIC_DIR = path.join(getAppRoot(), 'public')

app.use(hostCheck)
app.use(express.json({ limit: '50kb' }))
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }))

const log = createLogger('SERVER')

app.use('/api', apiRouter)
app.use(errorHandler)

async function main() {
  loadEnvFile()
  enableFileLogging()
  installShutdownHandlers()

  initState()
  const twitchClientId = getTwitchClientId()

  if (twitchClientId) initializeTwitchIntegration({ clientId: twitchClientId })
  else log.warn('Twitch integration disabled: TWITCH_CLIENT_ID is not set')

  const preferredPort = getServerConfig().port
  const { server, port } = await listenOnFreePort(preferredPort)

  if (port !== preferredPort) {
    // remembered, so the link does not change again on the next launch
    log.warn(`Port ${preferredPort} is busy, using ${port} instead. The overlay URL in OBS is now http://localhost:${port}/overlay`)
    updateServerConfig({ port: port })
  }

  log.log(`Server running on http://localhost:${port}`)
  void runStartupTasks()

  server.on('error', (error) => {
    log.error(`Fatal server error: ${error.message}`)
    void flushLogs().finally(() => process.exit(1))
  })
}

main().catch((error) => {
  log.error(`Fatal: ${describeError(error)}`)
  void flushLogs().finally(() => process.exit(1))
})
