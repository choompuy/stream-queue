import os from 'node:os'
import type { NextFunction, Request, Response } from 'express'
import { fail } from './http.js'
import { ownAddresses } from './local-only.js'

function originHost(origin: string | undefined): string {
  try {
    return origin ? new URL(origin).host : ''
  } catch {
    return ''
  }
}

function hostnameOf(hostHeader: string | undefined): string {
  if (!hostHeader) return ''
  // "[::1]:4747", "localhost:4747", "192.168.0.5:4747"
  const host = hostHeader.startsWith('[') ? hostHeader.slice(1, hostHeader.indexOf(']')) : hostHeader.split(':')[0]
  return host.toLowerCase()
}

function isAllowedHost(hostHeader: string | undefined): boolean {
  const host = hostnameOf(hostHeader)
  if (!host) return false
  if (host === 'localhost' || host.endsWith('.localhost')) return true

  const computer = os.hostname().toLowerCase()
  if (host === computer || host === `${computer}.local` || host === `${computer}.lan`) return true

  return ownAddresses().has(host)
}

export function hostCheck(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin
  // no Origin: not a browser, or a same-origin GET
  const originAllowed = origin === undefined || isAllowedHost(originHost(origin))

  if (isAllowedHost(req.headers.host) && originAllowed) return next()

  fail(res, 'this host is not allowed', 'FORBIDDEN_ORIGIN', 403)
}
