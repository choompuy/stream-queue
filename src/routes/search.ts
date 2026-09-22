import express from 'express'
import { SearchResponse } from '../types.js'
import { ok, fail, failFromError, asyncHandler } from '../http.js'
import { isLoopbackAddress } from '../local-only.js'
import { searchSongs } from '../youtube/index.js'

function log(message: string): void {
  console.log(`[SERVER] ${message}`)
}

export const router = express.Router()

router.get(
  '/',
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
