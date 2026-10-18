import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const { searchSongs, getVideoById } = await import('../../../src/youtube/index.js')
const { markQuotaExhausted, getSearchCache, setSearchCache, getVideoCache, setVideoCache, CACHE_LIMITS } = await import(
  '../../../src/youtube/cache.js'
)
const { updateSecrets } = await import('../../../src/secrets.js')
const { getConfig, updateConfig } = await import('../../../src/config.js')

const realFetch = globalThis.fetch

let requestsSent = 0

function stubSearch(behavior: 'success' | 'network-error' | 'timeout' | 'youtube-error' | 'quota-exceeded') {
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

    if (behavior === 'quota-exceeded') {
      return new Response(JSON.stringify({ error: { message: 'quota', errors: [{ reason: 'quotaExceeded' }] } }), {
        status: 403,
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

const video = (videoId: string, views: number) => ({
  id: videoId,
  snippet: {
    title: `Song ${videoId}`,
    channelTitle: 'Channel',
    categoryId: '10',
    thumbnails: { medium: { url: 'https://img/x.jpg' } }
  },
  contentDetails: { duration: 'PT3M' },
  statistics: { viewCount: String(views) },
  status: { privacyStatus: 'public', embeddable: true }
})

// a search that finds one video, and a video lookup that answers with `views` views for it
function stubFoundVideo(videoId: string, views: number): void {
  requestsSent = 0
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input))
    if (url.hostname !== 'www.googleapis.com') return realFetch(input, init)

    requestsSent++
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

    if (url.pathname.endsWith('/search')) return json({ items: [{ id: { videoId } }] })
    return json({ items: [video(videoId, views)] })
  }
}

test('search cache returns stored videos', async (t) => {
  await t.test('stores and returns the raw videos under the key it was given', () => {
    const key = `search-${Date.now()}-1`
    const raw = [video('test-video', 5)] as never[]
    setSearchCache(key, raw)
    assert.deepEqual(getSearchCache(key), raw)
  })

  await t.test('returns undefined for a missing key', () => {
    assert.equal(getSearchCache(`missing-${Date.now()}`), undefined)
  })

  await t.test('expires after its TTL', () => {
    const key = `search-ttl-${Math.random()}`
    setSearchCache(key, [] as never[])

    const realNow = Date.now
    Date.now = () => realNow() + CACHE_LIMITS.SEARCH_CACHE_TTL + 1

    try {
      assert.equal(getSearchCache(key), undefined)
    } finally {
      Date.now = realNow
    }
  })

  await t.test('setting the same key replaces the existing entry', () => {
    const key = `search-replace-${Date.now()}`
    setSearchCache(key, [video('video-1', 1)] as never[])
    setSearchCache(key, [video('video-2', 1)] as never[])
    assert.deepEqual(getSearchCache(key), [video('video-2', 1)])
  })

  await t.test('keeps at most 200 entries', () => {
    const prefix = `search-limit-${Date.now()}-`
    for (let i = 0; i < 201; i++) setSearchCache(`${prefix}${i}`, [] as never[])

    assert.equal(getSearchCache(`${prefix}0`), undefined)
    assert.deepEqual(getSearchCache(`${prefix}200`), [])
  })
})

test('video cache returns stored videos', async (t) => {
  await t.test('stores and returns the raw video, or null for a video that does not exist', () => {
    const found = `video-${Date.now()}-1`
    const missing = `video-${Date.now()}-2`
    setVideoCache(found, video(found, 1))
    setVideoCache(missing, null)

    assert.deepEqual(getVideoCache(found), video(found, 1))
    assert.equal(getVideoCache(missing), null)
  })

  await t.test('returns undefined for a missing key', () => {
    assert.equal(getVideoCache(`missing-${Date.now()}`), undefined)
  })

  await t.test('expires after its TTL', () => {
    const key = `video-ttl-${Math.random()}`
    setVideoCache(key, null)

    const realNow = Date.now
    Date.now = () => realNow() + CACHE_LIMITS.VIDEO_CACHE_TTL + 1

    try {
      assert.equal(getVideoCache(key), undefined)
    } finally {
      Date.now = realNow
    }
  })
})

test('a change of the filters does not throw away paid-for requests', async (t) => {
  const defaults = structuredClone(getConfig())

  t.after(() => updateConfig(defaults))

  await t.test('a cached search is re-filtered with the new settings, without a new request', async () => {
    const videoId = `y4search${Date.now()}`.slice(0, 11)
    stubFoundVideo(videoId, 1000)
    const query = `y4 search query ${Math.random()}`

    updateConfig({ minViews: 0 })
    const loose = await searchSongs(query)
    assert.equal(loose.length, 1, 'a 1000-views video passes minViews 0')
    assert.equal(requestsSent, 2, 'one search plus one video lookup')

    updateConfig({ minViews: 100000 })
    const strict = await searchSongs(query)
    assert.equal(strict.length, 0, 'the same cached result is filtered with the new minViews')
    assert.equal(requestsSent, 2, 'no new request: the filters do not invalidate the search cache')
  })

  await t.test('a cached video is re-checked against the new filters, without a new request', async () => {
    const videoId = `y4video${Date.now()}`.slice(0, 11)
    stubFoundVideo(videoId, 1000)

    updateConfig({ minViews: 0 })
    const song = await getVideoById(videoId)
    assert.equal(song?.videoId, videoId)
    assert.equal(requestsSent, 1, 'one video lookup')

    updateConfig({ minViews: 100000 })
    await assert.rejects(getVideoById(videoId), (error: { code?: string }) => error.code === 'VIEWS_TOO_LOW')
    assert.equal(requestsSent, 1, 'no new request: the filters are applied to the cached raw video')
  })

  await t.test('a content-mode change is a different search, and is not answered from the other mode\u2019s cache', async () => {
    const videoId = `y4mode${Date.now()}`.slice(0, 11)
    stubFoundVideo(videoId, 100000)
    const query = `y4 mode query ${Math.random()}`

    updateConfig({ contentMode: 'any' })
    await searchSongs(query)
    assert.equal(requestsSent, 2, 'the first mode does its own search')

    updateConfig({ contentMode: 'music' })
    await searchSongs(query)
    assert.equal(requestsSent, 4, 'music asks YouTube again: the search request itself is different')
  })
})

test('a query that normalization empties still searches', async (t) => {
  await t.test('searchSongs("!!!") sends q=!!! to the API', async () => {
    let asked: string | null = null
    globalThis.fetch = async (input) => {
      const url = new URL(String(input instanceof Request ? input.url : input))
      if (url.hostname === 'www.googleapis.com' && url.pathname.endsWith('/search')) asked = url.searchParams.get('q')
      return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    assert.deepEqual(await searchSongs('!!!'), [])
    assert.equal(asked, '!!!')
  })

  await t.test('a query of only whitespace is still nothing, and nothing is sent', async () => {
    let sent = 0
    globalThis.fetch = async () => {
      sent++
      return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    assert.deepEqual(await searchSongs('   '), [])
    assert.equal(sent, 0)
  })
})

// the last block in the file: these tests set the quota flag, and it stays set for the process
test('the quota flag gates every request to YouTube, not only searches', async (t) => {
  await t.test('a network failure does not exhaust the quota: the next request still goes out', async () => {
    stubSearch('network-error')
    await assert.rejects(searchSongs(`network fail query ${Math.random()}`), (error: { code?: string }) => error.code === 'YOUTUBE_ERROR')

    stubSearch('success')
    await searchSongs(`still works query ${Math.random()}`)
    assert.equal(requestsSent, 1, 'the request went out: a failure that never reached YouTube sets no flag')
  })

  await t.test('quotaExceeded from any answer sets the flag, and the next request is blocked at once', async () => {
    stubSearch('quota-exceeded')
    await assert.rejects(getVideoById('bbbbbbbbbbb'), (error: { code?: string }) => error.code === 'YOUTUBE_QUOTA')
    assert.equal(requestsSent, 1)

    stubSearch('success')
    await assert.rejects(searchSongs(`blocked query ${Math.random()}`), (error: { code?: string }) => error.code === 'YOUTUBE_QUOTA')
    assert.equal(requestsSent, 0, 'the flag blocks the request before it goes out')

    await assert.rejects(getVideoById('ccccccccccc'), (error: { code?: string }) => error.code === 'YOUTUBE_QUOTA')
    assert.equal(requestsSent, 0, 'also for a link')
  })

  await t.test('a link lookup is blocked while the quota is exhausted', async () => {
    stubSearch('success')
    markQuotaExhausted()

    await assert.rejects(getVideoById('aaaaaaaaaaa'), (error: { code?: string }) => error.code === 'YOUTUBE_QUOTA')
    assert.equal(requestsSent, 0, 'nothing goes out')
  })

  await t.test('a playlist update is blocked the same way', async () => {
    stubSearch('success')
    const { fetchPlaylistSongs } = await import('../../../src/youtube/index.js')

    await assert.rejects(fetchPlaylistSongs('PLtest1234567890'), (error: { code?: string }) => error.code === 'YOUTUBE_QUOTA')
    assert.equal(requestsSent, 0, 'nothing goes out')
  })
})
