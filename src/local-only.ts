import type { NextFunction, Request, Response } from 'express'
import { fail } from './http.js'
import { isLocalAddress } from './network.js'

declare module 'express-serve-static-core' {
  interface Request {
    /** Stamped once per request by determineLocality when the middleware runs: whether the request comes from this machine */
    isLocal?: boolean
  }
}

/** Stamps req.isLocal once, so every route that asks reads a memory read instead of re-asking the socket address. */
export function determineLocality(req: Request, _res: Response, next: NextFunction): void {
  req.isLocal = isLocalAddress(req.socket.remoteAddress)
  next()
}

// A test assembly that leaves the middleware out still gets the right answer: the stamp wins when it is there
export function isLocal(req: Request): boolean {
  return req.isLocal ?? isLocalAddress(req.socket.remoteAddress)
}

// Only lets through requests that come from the machine the app runs on. For actions that must not be reachable
// by other devices on the LAN, even though the API is otherwise open to them (shutdown, API key)
export function localOnly(req: Request, res: Response, next: NextFunction): void {
  if (isLocal(req)) {
    next()
    return
  }

  fail(res, 'LOCAL_ONLY')
}

// The panel asks for unfiltered results two ways (admin: true in a POST body, ?admin=1 in a GET query);
// whichever way it asks, only this machine's own requests may actually skip them
export function wantsBypassFilters(req: Request): boolean {
  const asked = (req.body as { admin?: unknown } | undefined)?.admin === true || req.query.admin === '1'
  return asked && isLocal(req)
}
