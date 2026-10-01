import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const { searchSongs } = await import('../../../src/youtube/index.js')
const { canSearch } = await import('../../../src/youtube/cache.js')
const { updateSecrets } = await import('../../../src/secrets.js')

const realFetch = globalThis.fetch

function stubSearch(behavior: 'success' | 'network-error' | 'youtube-error') {
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input))
    if (url.hostname !== 'www.googleapis.com') return realFetch(input, init)

    if (behavior === 'network-error') throw new TypeError('fetch failed')

    if (behavior === 'youtube-error') {
      return new Response(JSON.stringify({ error: { message: 'boom', errors: [{ reason: 'backendError' }] } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    if (url.pathname.endsWith('/search')) {
      return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
}

beforeEach(() => {
  updateSecrets({ youtubeApiKey: 'test-key' })
})

test('search quota is only consumed by a request that actually reached YouTube', async (t) => {
  await t.test('a network failure does not consume a search from the daily quota', async () => {
    stubSearch('network-error')

    await assert.rejects(searchSongs(`network fail query ${Math.random()}`))
    assert.equal(canSearch(), true)

    // exhaust the quota entirely with more network failures - it should never run out from these alone
    for (let i = 0; i < 100; i++) {
      await assert.rejects(searchSongs(`network fail query 2 ${i} ${Math.random()}`))
    }
    assert.equal(canSearch(), true)
  })

  await t.test('a YouTube-side error response does not consume a search from the daily quota', async () => {
    stubSearch('youtube-error')

    await assert.rejects(searchSongs(`api error query ${Math.random()}`))
    assert.equal(canSearch(), true)
  })

  await t.test('a successful search (even with zero results) does consume one from the quota', async () => {
    stubSearch('success')

    const before = canSearch()
    assert.equal(before, true)

    // exhaust the real quota with successful, distinct (uncached) queries and confirm it actually runs out
    for (let i = 0; i < 90; i++) {
      await searchSongs(`unique success query ${i} ${Math.random()}`)
    }
    assert.equal(canSearch(), false)
  })
})
