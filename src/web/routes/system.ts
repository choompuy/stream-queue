import express from 'express'
import os from 'node:os'
import { StateResponse, OverlayStateResponse } from '../core/types.js'
import { ok } from '../http.js'
import { getState } from '../core/player.js'
import { getSettings } from '../core/settings.js'
import { localOnly } from '../local-only.js'
import { shutdown } from '../infra/shutdown.js'

export function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flatMap((interfaces) => interfaces ?? [])
    .filter((iface) => iface.family === 'IPv4' && !iface.internal)
    .map((iface) => iface.address)
}

export function createSystemRouter({ exit = (code: number) => process.exit(code) }: { exit?: (code: number) => void } = {}): express.Router {
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
    res.on('finish', () => void shutdown(0, exit))
    ok(res, {})
  })

  return router
}

export const router = createSystemRouter()
