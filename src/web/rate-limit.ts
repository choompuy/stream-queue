import type { NextFunction, Request, Response } from 'express'
import { fail } from './http.js'

// A small sliding-window limiter per (IP, key), with no external dependency. The app is single-instance
// and single-process, so an in-memory window is enough; nothing here needs to survive a restart.
export function createRateLimiter({
  windowMs,
  max,
  keyPrefix
}: {
  windowMs: number // length of the sliding window, in ms
  max: number // requests allowed per IP within the window
  keyPrefix: string // distinguishes limiters that should not share buckets (e.g. "search" vs "queue-request")
}) {
  const hits = new Map<string, number[]>()

  function pruneOld(): void {
    const cutoff = Date.now() - windowMs
    for (const [key, timestamps] of hits) {
      const kept = timestamps.filter((t) => t > cutoff)
      if (kept.length) hits.set(key, kept)
      else hits.delete(key)
    }
  }

  // bounds memory use without a dedicated timer: a burst of many distinct IPs prunes itself as it grows
  const PRUNE_EVERY = 200
  let callsSincePrune = 0

  function middleware(req: Request, res: Response, next: NextFunction): void {
    const key = `${keyPrefix}:${req.ip ?? 'unknown'}`
    const now = Date.now()
    const cutoff = now - windowMs

    const timestamps = (hits.get(key) ?? []).filter((t) => t > cutoff)

    if (timestamps.length >= max) {
      const retryAfterMs = timestamps[0] + windowMs - now
      res.set('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))))
      fail(res, 'too many requests, please slow down', 'RATE_LIMITED', 429, { retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) })
      return
    }

    timestamps.push(now)
    hits.set(key, timestamps)

    if (++callsSincePrune >= PRUNE_EVERY) {
      callsSincePrune = 0
      pruneOld()
    }

    next()
  }

  return { middleware, _hitsForTest: hits }
}
