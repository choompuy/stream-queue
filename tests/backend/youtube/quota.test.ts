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

    return new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

beforeEach(() => {
  updateSecrets({ youtubeApiKey: 'test-key' })
})

test('search quota is only consumed by a request that actually reached YouTube', async (t) => {
  await t.test('a network failure releases the reserved search quota', async () => {
    stubSearch('network-error')
    assert.equal(canSearch(), true)
    await assert.rejects(searchSongs(`network fail query ${Math.random()}`))
    assert.equal(canSearch(), true)

    for (let i = 0; i < 5; i++) {
      await assert.rejects(searchSongs(`network fail query ${i} ${Math.random()}`))
    }
    assert.equal(canSearch(), true)
  })

  await t.test('a YouTube-side error response does not consume a search from the daily quota', async () => {
    stubSearch('youtube-error')
    assert.equal(canSearch(), true)
    await assert.rejects(searchSongs(`api error query ${Math.random()}`))
    assert.equal(canSearch(), true)
  })

  await t.test('a successful search consumes one search from the quota', async () => {
    stubSearch('success')
    assert.equal(canSearch(), true)
    await searchSongs(`unique success query ${Math.random()}`)
    // One successful request consumed one of the 90 daily searches.
    for (let i = 1; i < 90; i++) {
      await searchSongs(`unique success query ${i} ${Math.random()}`)
    }
    assert.equal(canSearch(), false)
  })
})
