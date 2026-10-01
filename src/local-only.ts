import type { NextFunction, Request, Response } from 'express'
import { fail } from './http.js'

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false
  return address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.')
}

// Only lets through requests that come from the machine the app runs on. For actions that must not be reachable
// by other devices on the LAN, even though the API is otherwise open to them (shutdown, API key)
export function localOnly(req: Request, res: Response, next: NextFunction): void {
  if (isLoopbackAddress(req.socket.remoteAddress)) {
    next()
    return
  }

  fail(res, 'this action is only available from the computer the app is running on', 'LOCAL_ONLY', 403)
}
