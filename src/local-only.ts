import type { NextFunction, Request, Response } from 'express'
import os from 'node:os'
import { fail } from './http.js'

export function isLoopbackAddress(address: string | undefined): boolean {
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

  fail(res, 'this action is only available from the computer the app is running on', 'LOCAL_ONLY', 403)
}
