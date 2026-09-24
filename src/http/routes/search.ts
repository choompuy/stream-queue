import express from 'express'
import { SearchResponse } from '../../shared/types.js'
import { ok, fail, failFromError, asyncHandler } from '../router.js'
import { isLoopbackAddress } from '../../local-only.js'
import { createRateLimiter } from '../../rate-limit.js'
import { searchSongs } from '../../integrations/youtube/index.js'

function log(message: string): void {
  console.log(`[SERVER] ${message}`)
}

export const router = express.Router()

// the panel searches as the streamer types, so this allows a fast typing burst; still far below the daily quota
const searchLimiter = createRateLimiter({ windowMs: 60_000, max: 30, keyPrefix: 'search' })

router.get(
  '/',
  searchLimiter.middleware,
  asyncHandler(async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    const bypassFilters = req.query.admin === '1' && isLoopbackAddress(req.socket.remoteAddress)

    if (query.length < 2) {
      return fail(res, 'query must be at least 2 characters', 'INVALID_QUERY', 400)
    }

    try {
      const songs = await searchSongs(query, bypassFilters)
      ok<SearchResponse>(res, { results: songs })
    } catch (error) {
      log(`[ERROR] Search: ${error instanceof Error ? error.message : error}`)
      failFromError(res, error)
    }
  })
)
