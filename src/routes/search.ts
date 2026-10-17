import express from 'express'
import { SearchResponse } from '../types.js'
import { ok, fail } from '../http.js'
import { isLocalAddress } from '../local-only.js'
import { searchSongs } from '../youtube/index.js'
import { markBlocked } from '../blocklist.js'

export const router = express.Router()

router.get('/', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  const bypassFilters = req.query.admin === '1' && isLocalAddress(req.socket.remoteAddress)

  if (query.length < 2) {
    return fail(res, 'INVALID_QUERY', 400)
  }

  const songs = await searchSongs(query, bypassFilters)
  ok<SearchResponse>(res, { results: markBlocked(songs) })
})
