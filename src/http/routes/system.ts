import express from 'express'
import os from 'node:os'
import { StateResponse, OverlayStateResponse } from '../../shared/types.js'
import { ok } from '../router.js'
import { getState } from '../../core/player/service.js'
import { getSettings } from '../../settings.js'
import { flushAllStores } from '../../infrastructure/persistence/file-store.js'
import { localOnly } from '../../local-only.js'

export function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flatMap((interfaces) => interfaces ?? [])
    .filter((iface) => iface.family === 'IPv4' && !iface.internal)
    .map((iface) => iface.address)
}

export function createSystemRouter({ exit = () => process.exit(0) }: { exit?: () => void } = {}): express.Router {
  const router = express.Router()

  router.get('/state', (_req, res) => {
    ok<StateResponse>(res, getState())
  })

  router.get('/overlay-state', (_req, res) => {
    ok<OverlayStateResponse>(res, { state: getState(), settings: getSettings() })
  })

  router.get('/network-info', (req, res) => {
    ok(res, { port: req.socket.localPort, ips: lanAddresses() })
  })

  router.post('/shutdown', localOnly, (_req, res) => {
    res.on('finish', () => {
      flushAllStores()
        .catch((error) => console.error('[SHUTDOWN] Flush failed:', error instanceof Error ? error.message : error))
        .finally(exit)
    })
    ok(res, {})
  })

  return router
}

export const router = createSystemRouter()
