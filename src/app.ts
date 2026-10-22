import express from 'express'
import path from 'node:path'
import type { Server } from 'node:http'

import { getAppRoot } from './runtime.js'
import { hostCheck } from './host-check.js'
import { determineLocality } from './local-only.js'
import { errorHandler } from './error-handler.js'
import { apiRouter } from './routes/index.js'

/** Thrown by listenOnFreePort when every candidate port is busy: the startup report turns it into the NO_FREE_PORT notice. */
export class NoFreePortError extends Error {
  constructor(
    public readonly from: number,
    public readonly to: number
  ) {
    super(`No free port in ${from}-${to}`)
    this.name = 'NoFreePortError'
  }
}

/** The folder express.static serves; the startup check looks into the same path, so the two cannot drift apart. */
export const getPublicDir = (): string => path.join(getAppRoot(), 'public')

/** The assembled app: nothing runs on import, so a test can build the app without starting it. */
export function createApp(): express.Express {
  const app = express()
  const publicDir = getPublicDir()

  app.use(hostCheck)
  app.use(determineLocality)
  app.use(express.json({ limit: '50kb' }))
  app.use(express.static(publicDir, { extensions: ['html'] }))

  app.use('/api', apiRouter)
  app.use(errorHandler)
  return app
}

/** Binds the given app to the first free port from `start` upward, so a busy port only shifts the link. */
export async function listenOnFreePort(
  app: express.Express,
  start: number
): Promise<{ server: Server; port: number }> {
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
  throw new NoFreePortError(start, start + 99)
}
