import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const { searchSongs } = await import('../../../src/youtube/index.js')
const { getSearchesToday, releaseSearchQuota, reserveSearchQuota, setVideoCache, getVideoCache, setSearchCache, getSearchCache, CACHE_LIMITS } =
  await import('../../../src/youtube/cache.js')
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
    const before = getSearchesToday()
    await assert.rejects(searchSongs(`network fail query ${Math.random()}`))
    assert.equal(getSearchesToday(), before)

    for (let i = 0; i < 5; i++) {
      await assert.rejects(searchSongs(`network fail query ${i} ${Math.random()}`))
    }
    assert.equal(getSearchesToday(), before)
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
    while (guard++ < 500) {
      try {
        await searchSongs(`unique success query ${guard} ${Math.random()}`)
      } catch {
        // expected after limit
      }
    }

    assert.equal(getSearchesToday(), CACHE_LIMITS.MAX_DAILY_SEARCHES)
  })
})

test('search quota reservation increments the count', () => {
  while (getSearchesToday() > 0) releaseSearchQuota()
  const before = getSearchesToday()

  assert.equal(reserveSearchQuota(), true)
  assert.equal(getSearchesToday(), before + 1)

  releaseSearchQuota()
  assert.equal(getSearchesToday(), before)
})

test('search quota reservation stops at the daily limit', () => {
  const before = getSearchesToday()

  while (getSearchesToday() < CACHE_LIMITS.MAX_DAILY_SEARCHES) assert.equal(reserveSearchQuota(), true)

  assert.equal(getSearchesToday(), CACHE_LIMITS.MAX_DAILY_SEARCHES)
  assert.equal(reserveSearchQuota(), false)
  assert.equal(getSearchesToday(), CACHE_LIMITS.MAX_DAILY_SEARCHES)

  while (getSearchesToday() > before) releaseSearchQuota()
})

test('releasing search quota does not make the count negative', () => {
  while (getSearchesToday() > 0) releaseSearchQuota()

  releaseSearchQuota()

  assert.equal(getSearchesToday(), 0)
})

test('search cache returns stored songs', async () => {
  const { getSearchCache, setSearchCache } = await import('../../../src/youtube/cache.js')

  const songs = [
    {
      videoId: 'test-video',
      title: 'Test song',
      channelTitle: 'Test channel'
    }
  ] as any

  const key = `cache-test-${Math.random()}`

  setSearchCache(key, songs)

  assert.deepEqual(getSearchCache(key), songs)
})

test('search cache returns undefined for an unknown key', async () => {
  const { getSearchCache } = await import('../../../src/youtube/cache.js')

  assert.equal(getSearchCache(`missing-${Math.random()}`), undefined)
})

test('video cache returns stored result', async () => {
  const { getVideoCache, setVideoCache } = await import('../../../src/youtube/cache.js')

  const result = {
    song: null,
    reason: 'VIDEO_NOT_FOUND'
  } as any

  const key = `video-cache-test-${Math.random()}`

  setVideoCache(key, result)

  assert.deepEqual(getVideoCache(key), result)
})

test('video cache returns undefined for an unknown key', async () => {
  const { getVideoCache } = await import('../../../src/youtube/cache.js')

  assert.equal(getVideoCache(`missing-${Math.random()}`), undefined)
})
test('search cache expires after TTL', () => {
  const key = `search-ttl-${Math.random()}`
  const songs = [{ videoId: 'test-video' }] as any

  setSearchCache(key, songs)

  const realNow = Date.now
  Date.now = () => realNow() + CACHE_LIMITS.SEARCH_CACHE_TTL + 1

  try {
    assert.equal(getSearchCache(key), undefined)
  } finally {
    Date.now = realNow
  }
})

test('video cache expires after TTL', () => {
  const key = `video-ttl-${Math.random()}`
  const result = { song: null, reason: null }

  setVideoCache(key, result)

  const realNow = Date.now
  Date.now = () => realNow() + CACHE_LIMITS.VIDEO_CACHE_TTL + 1

  try {
    assert.equal(getVideoCache(key), undefined)
  } finally {
    Date.now = realNow
  }
})
