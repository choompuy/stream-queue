import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const { searchSongs } = await import('../../../src/youtube/index.js')
const { canSearch, getSearchesToday, CACHE_LIMITS } = await import('../../../src/youtube/cache.js')
const { updateSecrets } = await import('../../../src/secrets.js')

const realFetch = globalThis.fetch

let requestsSent = 0

function stubSearch(behavior: 'success' | 'network-error' | 'timeout' | 'youtube-error') {
  requestsSent = 0
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input))
    if (url.hostname !== 'www.googleapis.com') return realFetch(input, init)

    requestsSent++
    if (behavior === 'network-error') throw new TypeError('fetch failed')
    if (behavior === 'timeout') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')

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

  await t.test('a timeout stays counted: YouTube may have charged the request whose answer got lost', async () => {
    stubSearch('timeout')
    const before = getSearchesToday()
    await assert.rejects(searchSongs(`timeout query ${Math.random()}`))
    assert.equal(getSearchesToday(), before + 1)
  })

  await t.test('an error answer from YouTube stays counted, and the search is sent once, not three times', async () => {
    stubSearch('youtube-error')
    const before = getSearchesToday()
    await assert.rejects(searchSongs(`api error query ${Math.random()}`))
    assert.equal(getSearchesToday(), before + 1)
    assert.equal(requestsSent, 1)
  })

  await t.test('a missing API key sends nothing and costs nothing', async () => {
    stubSearch('success')
    updateSecrets({ youtubeApiKey: '' })
    const before = getSearchesToday()
    await assert.rejects(searchSongs(`no key query ${Math.random()}`))
    assert.equal(getSearchesToday(), before)
    assert.equal(requestsSent, 0)
  })

  await t.test('a successful search consumes one search from the quota, and the daily limit then stops further searches', async () => {
    stubSearch('success')
    const before = getSearchesToday()
    await searchSongs(`unique success query ${Math.random()}`)
    assert.equal(getSearchesToday(), before + 1)

    let guard = 0
    while (canSearch() && guard++ < 500) await searchSongs(`unique success query ${guard} ${Math.random()}`)

    assert.equal(canSearch(), false)
    assert.equal(getSearchesToday(), CACHE_LIMITS.MAX_DAILY_SEARCHES)
  })
})
