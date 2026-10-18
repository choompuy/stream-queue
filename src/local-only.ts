import type { NextFunction, Request, Response } from 'express'
import os from 'node:os'
import { fail } from './http.js'

function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false
  return address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.')
}

const withoutMappedPrefix = (address: string): string => address.replace(/^::ffff:/i, '').toLowerCase()

const ADDRESSES_TTL_MS = 5000
let cachedAddresses: { at: number; set: Set<string> } | null = null

export function ownAddresses(): Set<string> {
  if (cachedAddresses && Date.now() - cachedAddresses.at < ADDRESSES_TTL_MS) return cachedAddresses.set

  const addresses = Object.values(os.networkInterfaces())
    .flatMap((interfaces) => interfaces ?? [])
    .map((iface) => withoutMappedPrefix(iface.address.split('%')[0]))

  cachedAddresses = { at: Date.now(), set: new Set(addresses) }
  return cachedAddresses.set
}

export function isLocalAddress(address: string | undefined): boolean {
  if (!address) return false
  return isLoopbackAddress(address) || ownAddresses().has(withoutMappedPrefix(address.split('%')[0]))
}

// Only lets through requests that come from the machine the app runs on. For actions that must not be reachable
// by other devices on the LAN, even though the API is otherwise open to them (shutdown, API key)
export function localOnly(req: Request, res: Response, next: NextFunction): void {
  if (isLocalAddress(req.socket.remoteAddress)) {
    next()
    return
  }

  fail(res, 'LOCAL_ONLY')
}

// The panel asks for unfiltered results two ways (admin: true in a POST body, ?admin=1 in a GET query);
// whichever way it asks, only this machine's own requests may actually skip them
export function wantsBypassFilters(req: Request): boolean {
  const asked = (req.body as { admin?: unknown } | undefined)?.admin === true || req.query.admin === '1'
  return asked && isLocalAddress(req.socket.remoteAddress)
}
