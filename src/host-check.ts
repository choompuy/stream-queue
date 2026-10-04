import os from 'node:os'
import type { NextFunction, Request, Response } from 'express'
import { fail } from './http.js'
import { ownAddresses } from './local-only.js'

function hostnameOf(hostHeader: string | undefined): string {
  if (!hostHeader) return ''
  // "[::1]:4747", "localhost:4747", "192.168.0.5:4747"
  const host = hostHeader.startsWith('[') ? hostHeader.slice(1, hostHeader.indexOf(']')) : hostHeader.split(':')[0]
  return host.toLowerCase()
}

export function isAllowedHost(hostHeader: string | undefined): boolean {
  const host = hostnameOf(hostHeader)
  if (!host) return false
  if (host === 'localhost' || host.endsWith('.localhost')) return true

  const computer = os.hostname().toLowerCase()
  if (host === computer || host === `${computer}.local` || host === `${computer}.lan`) return true

  return ownAddresses().has(host)
}

export function hostCheck(req: Request, res: Response, next: NextFunction): void {
  if (isAllowedHost(req.headers.host)) {
    next()
    return
  }

  fail(res, 'this host is not allowed', 'FORBIDDEN_ORIGIN', 403)
}
