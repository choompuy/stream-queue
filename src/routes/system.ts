import express from 'express'
import os from 'node:os'
import { StateResponse, OverlayStateResponse } from '../types.js'
import { ok } from '../http.js'
import { getState } from '../player.js'
import { getSettings } from '../settings.js'
import { flushAllStores } from '../persist.js'
import { localOnly } from '../local-only.js'
import { createLogger, describeError, flushLogs } from '../logger.js'

const log = createLogger('SHUTDOWN')

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
        .catch((error) => log.error(`Flush failed: ${describeError(error)}`))
        .then(flushLogs)
        .finally(exit)
    })
    ok(res, {})
  })

  return router
}

export const router = createSystemRouter()
