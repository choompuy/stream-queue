import express from 'express'
import { SearchResponse } from '../types.js'
import { ok } from '../http.js'
import { wantsBypassFilters } from '../local-only.js'
import { checkQuery } from '../validate.js'
import { searchSongs } from '../youtube/index.js'
import { markBlocked } from '../blocklist.js'

export const router = express.Router()

router.get('/', async (req, res) => {
  const query = checkQuery(req.query.q)
  const bypassFilters = wantsBypassFilters(req)

  const songs = await searchSongs(query, bypassFilters)
  ok<SearchResponse>(res, { results: markBlocked(songs) })
})
