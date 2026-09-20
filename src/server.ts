import express from 'express'
import cors from 'cors'
import { exec } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

import { StateResponse, OverlayStateResponse } from './types.js'
import { findAvailablePort } from './port.js'
import { ok, fail } from './http.js'
import { getSettings } from './settings.js'
import { getAppRoot } from './runtime.js'
import { getState, moveToNext } from './player.js'
import { flushAllStores } from './persist.js'
import { refreshFallback } from './fallback.js'

import { router as settingsRouter } from './routes/settings.js'
import { router as playlistsRouter } from './routes/playlists.js'
import { router as blocklistRouter } from './routes/blocklist.js'
import { router as searchRouter } from './routes/search.js'
import { router as activityRouter } from './routes/activity.js'
import { router as queueRouter } from './routes/queue.js'
import { router as playerRouter } from './routes/player.js'
import { router as fallbackRouter } from './routes/fallback.js'
import { router as chatRouter } from './routes/chat.js'

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

      callback(new Error('Not allowed by CORS'))
    }
  })
)
app.use(express.json({ limit: '50kb' }))
app.use(express.static(PUBLIC_DIR))

function log(message: string) {
  console.log(`[SERVER] ${message}`)
}

app.get('/api/network-info', (_req, res) => {
  const ips: string[] = []
  const interfaces = os.networkInterfaces()

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address)
      }
    }
  }

  ok(res, { port: PORT, ips })
})

app.get('/overlay', (_req, res) => {
  res.sendFile('overlay.html', {
    root: PUBLIC_DIR
  })
})

app.get('/api/state', (_req, res) => {
  ok<StateResponse>(res, getState())
})

app.get('/api/overlay-state', (_req, res) => {
  ok<OverlayStateResponse>(res, { state: getState(), settings: getSettings() })
})

app.use('/api', settingsRouter)
app.use('/api/playlists', playlistsRouter)
app.use('/api/blocklist', blocklistRouter)
app.use('/api/search', searchRouter)
app.use('/api/activity', activityRouter)
app.use('/api/queue', queueRouter)
app.use('/api/player', playerRouter)
app.use('/api/fallback', fallbackRouter)
app.use('/api/chat', chatRouter)

app.post('/api/shutdown', (_req, res) => {
  res.on('finish', () => {
    flushAllStores()
      .catch((error) => console.error('[SHUTDOWN] Flush failed:', error instanceof Error ? error.message : error))
      .finally(() => process.exit(0))
  })
  ok(res, {})
})

app.use('/api', (_req, res) => {
  fail(res, 'API endpoint not found', 'NOT_FOUND', 404)
})

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  log(`[ERROR] ${err.message}`)
  fail(res, 'internal server error', 'SERVER_ERROR', 500)
})

function openBrowser(url: string): void {
  if (process.platform === 'win32') {
    exec(`start "" "${url}"`)
    return
  }

  if (process.platform === 'darwin') {
    exec(`open "${url}"`)
    return
  }

  exec(`xdg-open "${url}"`)
}

async function main() {
  PORT = await findAvailablePort(3000)

  app.listen(PORT, async () => {
    log(`Server running on http://localhost:${PORT}`)
    await refreshFallback()
    if (!getState().current) {
      moveToNext()
    }
  })
}

main().catch((error) => {
  console.error('[FATAL]', error instanceof Error ? error.message : error)
  process.exit(1)
})
