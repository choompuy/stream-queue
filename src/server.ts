import express from 'express'
import cors from 'cors'
import path from 'node:path'

import { findAvailablePort } from './port.js'
import { getAppRoot } from './runtime.js'
import { initState } from './state-file.js'
import { runStartupTasks } from './startup.js'
import { errorHandler, ForbiddenOriginError } from './error-handler.js'
import { apiRouter } from './routes/index.js'
import { initializeTwitchIntegration } from './integrations/twitch/index.js'
import { getSecrets } from './secrets.js'

const app = express()
let PORT: number

const LAN_HOSTNAME_PATTERN = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/
const PUBLIC_DIR = path.join(getAppRoot(), 'public')

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

function log(message: string) {
  console.log(`[SERVER] ${message}`)
}

app.get('/overlay', (_req, res) => {
  res.sendFile('overlay.html', {
    root: PUBLIC_DIR
  })
})

app.use('/api', apiRouter)

app.use(errorHandler)

async function main() {
  // a stray rejected promise must not stop the music mid-stream: log it and carry on
  process.on('unhandledRejection', (reason) => {
    console.error('[UNHANDLED REJECTION]', reason instanceof Error ? (reason.stack ?? reason.message) : reason)
  })

  initState()
  const secrets = getSecrets()
  PORT = await findAvailablePort(3000)
  
  initializeTwitchIntegration({
    clientId: secrets.twitch.clientId ?? undefined,
    clientSecret: secrets.twitch.clientSecret ?? undefined,
    redirectUri: `http://localhost:${PORT}/api/integrations/twitch/callback`
  })

  const server = app.listen(PORT, () => {
    log(`Server running on http://localhost:${PORT}`)
    void runStartupTasks()
  })

  server.on('error', (error) => {
    console.error('[FATAL] Server error:', error.message)
    process.exit(1)
  })
}

main().catch((error) => {
  console.error('[FATAL]', error instanceof Error ? error.message : error)
  process.exit(1)
})
