import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const fallback = await import('../../src/fallback.js')
const { getConfig, updateConfig } = await import('../../src/config.js')
const { updateSecrets } = await import('../../src/secrets.js')
const { setCurrent } = await import('../../src/queue.js')

updateSecrets({ youtubeApiKey: 'test-key' })

const song = (id: string, title = id) => ({
  videoId: id,
  title,
  channelTitle: 'Channel',
  thumbnail: '',
  duration: 200,
  views: 1_000_000,
  url: `https://youtu.be/${id}`
})

// stubs the YouTube endpoints that fetchPlaylistSongs() calls internally; itemCount is the size the
// playlist declares about itself (often bigger than what it gives: private and deleted videos, the page limit)
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

function stubPlaylist(ids: string[], { itemCount = ids.length } = {}) {
  const realFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input))
    if (url.hostname !== 'www.googleapis.com') return realFetch(input, init)

    if (url.pathname.endsWith('/playlistItems')) {
      return json({ items: ids.map((id) => ({ snippet: { resourceId: { videoId: id } } })) })
    }

    if (url.pathname.endsWith('/playlists')) {
      return json({ items: [{ id: url.searchParams.get('id'), snippet: { title: 'Stub playlist' }, contentDetails: { itemCount } }] })
    }

    // /videos
    const requestedIds = (url.searchParams.get('id') ?? '').split(',').filter(Boolean)
    const items = requestedIds.map((id) => ({
      id,
      snippet: { title: `Title ${id}`, channelTitle: 'Channel', categoryId: '10', thumbnails: { medium: { url: '' } } },
      contentDetails: { duration: 'PT3M20S' },
      statistics: { viewCount: '1000000' },
      status: { privacyStatus: 'public', embeddable: true, uploadStatus: 'processed' }
    }))
    return json({ items })
  }
}

const A = 'aaaaaaaaaaa'
const B = 'bbbbbbbbbbb'
const C = 'ccccccccccc'
const D = 'ddddddddddd'
const E = 'eeeeeeeeeee'
const F = 'fffffffffff'

let plCounter = 0
let PL = ''

beforeEach(async () => {
  setCurrent(null)
  // a fresh, never-before-used playlist id per test: refreshFallback() only takes the "first load" branch
  // (which fully replaces the rotation) when loadedFallbackPlaylistId !== the new id, and that module-level
  // id is not reset by beforeEach - reusing the same id across subtests would make every subtest after the
  // first start from a reconciliation against the previous subtest's leftover state instead of a clean load
  PL = `PLrefreshtest${String(++plCounter).padStart(3, '0')}`
  updateConfig({ fallbackPlaylist: { playlistId: null, enabled: true, repeat: false, shuffle: false } })
  // saving the id already starts the reaction, which resets the rotation through the "no playlist" branch
  await fallback.settledConfigReaction(null)
})

// Drives the rotation forward `steps` times exactly the way player.ts does it (advanceFallback() sets the
// cursor, setCurrent() is called with what it returns), so the cursor ends up in the same state it would
// during real playback instead of being set directly.
function advanceTo(steps: number): void {
  for (let i = 0; i < steps; i++) setCurrent(fallback.advanceFallback())
}

test('refreshFallback() rebuilds rotation around the playing track', async (t) => {
  await t.test('when shuffle is off, the playing track stays in place and the rest follow natural order', async () => {
    stubPlaylist([A, B, C, D, E, F])
    updateConfig({ fallbackPlaylist: { playlistId: PL, shuffle: false } })
    await fallback.settledConfigReaction(PL)

    advanceTo(3)
    setCurrent({ ...song(C), requestedBy: 'Playlist', isFallback: true })

    stubPlaylist([A, B, D, E, F]) // C removed from the source playlist
    await fallback.refreshFallback()

    // Since C is no longer in the playlist, the rotation is rebuilt without it
    // The cursor is reset to -1, and the next track is A (first in the new rotation)
    assert.equal(fallback.advanceFallback()?.videoId, A)
  })

  await t.test('when the playing track is still in the playlist, it stays in place', async () => {
    stubPlaylist([A, B, C, D])
    updateConfig({ fallbackPlaylist: { playlistId: PL, shuffle: false } })
    await fallback.settledConfigReaction(PL)

    advanceTo(2)
    setCurrent({ ...song(B), requestedBy: 'Playlist', isFallback: true })

    stubPlaylist([A, B, C, D, E]) // nothing removed, E added
    await fallback.refreshFallback()

    // B is still in the playlist, so the rotation is rebuilt around it
    assert.equal(fallback.advanceFallback()?.videoId, C)
  })

  await t.test('when shuffle is on, the unplayed remainder is reshuffled around the playing track', async () => {
    stubPlaylist([A, B, C, D])
    updateConfig({ fallbackPlaylist: { playlistId: PL, shuffle: true } })
    await fallback.settledConfigReaction(PL)

    advanceTo(2)
    setCurrent({ ...song(B), requestedBy: 'Playlist', isFallback: true })

    stubPlaylist([A, B, C, D, E]) // nothing removed, E added
    await fallback.refreshFallback()

    // B is still in the playlist, the rest is reshuffled around it
    const order = fallback.getFallbackSnapshot().order
    assert.equal(order[0], B, 'playing track stays first')
    assert.deepEqual(order.slice(1).sort(), [A, C, D, E], 'the rest are all present')
  })
})

test('the reaction to a saved playlist id', async (t) => {
  await t.test('a load that fails restores the id that was there before and says why', async (t2) => {
    const errors = t2.mock.method(console, 'error', () => {})
    const realFetch = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input instanceof Request ? input.url : input))
      if (url.hostname === 'www.googleapis.com') return new Response(JSON.stringify({ error: { message: 'refused' } }), { status: 403 })
      return realFetch(input, init)
    }

    try {
      updateConfig({ fallbackPlaylist: { playlistId: PL } })

      await assert.rejects(fallback.settledConfigReaction(PL))
      assert.equal(getConfig().fallbackPlaylist.playlistId, null, 'rolled back')
      assert.equal(fallback.getFallbackSnapshot().playlistId, null, 'the rotation keeps what it had')

      // exactly one line, and it carries the cause, not only the ids
      assert.equal(errors.mock.callCount(), 1)
      const line = String(errors.mock.calls[0]?.arguments ?? '')
      assert.ok(line.includes('could not be loaded'), line)
      assert.ok(line.includes('refused'), line)
    } finally {
      globalThis.fetch = realFetch
    }
  })

  await t.test('a rollback to a playlist that was never loaded does not start another load', async () => {
    const realFetch = globalThis.fetch
    let attempts = 0
    const refusing = async (input: unknown, init?: unknown) => {
      const url = new URL(String(input instanceof Request ? input.url : input))
      if (url.hostname !== 'www.googleapis.com') return realFetch(input as never, init as never)
      attempts++
      return new Response(JSON.stringify({ error: { message: 'refused' } }), { status: 403 })
    }

    try {
      stubPlaylist([A])
      updateConfig({ fallbackPlaylist: { playlistId: PL } })
      await fallback.settledConfigReaction(PL)

      // a start without a network: the config names a playlist the rotation does not hold
      fallback.hydrateFallback({ sourceTracks: [], order: [], cursor: -1, playlistId: null, lastRefreshedAt: null })

      globalThis.fetch = refusing
      const other = 'PLrollbacktest1'
      updateConfig({ fallbackPlaylist: { playlistId: other } })

      await assert.rejects(fallback.settledConfigReaction(other))
      assert.equal(getConfig().fallbackPlaylist.playlistId, PL, 'rolled back to the configured playlist')

      // timers get their turn only when the rollback did not start a load of its own
      await new Promise((resolve) => setTimeout(resolve, 60))
      assert.equal(attempts, 1, 'exactly one load was attempted')
      assert.equal(getConfig().fallbackPlaylist.playlistId, PL)
    } finally {
      globalThis.fetch = realFetch
    }
  })

  await t.test('the reaction of a playlist can be awaited by more than one caller', async () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input instanceof Request ? input.url : input))
      if (url.hostname === 'www.googleapis.com') return new Response(JSON.stringify({ error: { message: 'refused' } }), { status: 403 })
      return realFetch(input, init)
    }

    try {
      updateConfig({ fallbackPlaylist: { playlistId: PL } })

      const first = fallback.settledConfigReaction(PL)
      const second = fallback.settledConfigReaction(PL)

      await assert.rejects(first)
      await assert.rejects(second)
    } finally {
      globalThis.fetch = realFetch
    }
  })

  await t.test('a load that fails after the playlist was replaced neither rolls back nor throws', async () => {
    const other = 'PLreplacedtest1'
    const realFetch = globalThis.fetch
    // the first playlist answers slowly with a refusal, the one that replaces it answers at once
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input instanceof Request ? input.url : input))
      if (url.hostname === 'www.googleapis.com' && url.searchParams.get('playlistId') === PL) {
        await new Promise((resolve) => setTimeout(resolve, 30))
        return new Response(JSON.stringify({ error: { message: 'refused' } }), { status: 403 })
      }
      return realFetch(input, init)
    }

    try {
      updateConfig({ fallbackPlaylist: { playlistId: PL } })
      stubPlaylist([A, B])

      updateConfig({ fallbackPlaylist: { playlistId: other } })
      await fallback.settledConfigReaction(other)

      // the stale failure of the first load arrives after its playlist was already replaced
      await new Promise((resolve) => setTimeout(resolve, 60))

      assert.equal(getConfig().fallbackPlaylist.playlistId, other, 'the newer save is not rolled back')
      assert.deepEqual(fallback.getFallbackSnapshot().order, [A, B], 'the newer playlist is loaded')
    } finally {
      globalThis.fetch = realFetch
    }
  })
})

test('what loading the playlist keeps and reports', async (t) => {
  await t.test("what the viewer rules would trim away stays: the streamer's own playlist answers to the guard rules alone", async () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input instanceof Request ? input.url : input))
      if (url.hostname !== 'www.googleapis.com') return realFetch(input, init)

      if (url.pathname.endsWith('/playlistItems')) {
        return json({ items: [{ snippet: { resourceId: { videoId: A } } }] })
      }
      if (url.pathname.endsWith('/playlists')) {
        return json({ items: [{ id: PL, snippet: { title: 'Stub playlist' }, contentDetails: { itemCount: 1 } }] })
      }

      // a track the viewer rules refuse three times over: wrong category, longer than the maximum, barely any views
      return json({
        items: [
          {
            id: A,
            snippet: { title: 'Stub', channelTitle: 'Channel', categoryId: '20', thumbnails: { medium: { url: '' } } },
            contentDetails: { duration: 'PT10M' },
            statistics: { viewCount: '42' },
            status: { privacyStatus: 'public', embeddable: true, uploadStatus: 'processed' }
          }
        ]
      })
    }

    try {
      updateConfig({ fallbackPlaylist: { playlistId: PL } })
      await fallback.settledConfigReaction(PL)

      const state = fallback.getFallbackState()
      assert.equal(state.sourceCount, 1, 'the track is loaded')
      assert.deepEqual(state.upNext.map((track) => track.videoId), [A])
    } finally {
      globalThis.fetch = realFetch
    }
  })

  await t.test('a track the guard rules refuse is still dropped', async () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input instanceof Request ? input.url : input))
      if (url.hostname !== 'www.googleapis.com') return realFetch(input, init)

      if (url.pathname.endsWith('/playlistItems')) {
        return json({ items: [{ snippet: { resourceId: { videoId: A } } }] })
      }
      if (url.pathname.endsWith('/playlists')) {
        return json({ items: [{ id: PL, snippet: { title: 'Stub playlist' }, contentDetails: { itemCount: 1 } }] })
      }

      // a private track cannot be played by anyone, the streamer included
      return json({
        items: [
          {
            id: A,
            snippet: { title: 'Stub', channelTitle: 'Channel', categoryId: '10', thumbnails: { medium: { url: '' } } },
            contentDetails: { duration: 'PT3M20S' },
            statistics: { viewCount: '1000000' },
            status: { privacyStatus: 'private', embeddable: true, uploadStatus: 'processed' }
          }
        ]
      })
    }

    try {
      updateConfig({ fallbackPlaylist: { playlistId: PL } })
      await fallback.settledConfigReaction(PL)

      const state = fallback.getFallbackState()
      assert.equal(state.sourceCount, 0, 'the private track is not loaded')
      assert.deepEqual(state.upNext, [])
    } finally {
      globalThis.fetch = realFetch
    }
  })

  await t.test('the declared size of the playlist travels with the state: the panel can show how much is playable', async () => {
    stubPlaylist([A, B, C], { itemCount: 10 })
    updateConfig({ fallbackPlaylist: { playlistId: PL } })
    await fallback.settledConfigReaction(PL)

    const state = fallback.getFallbackState()
    assert.equal(state.sourceCount, 3)
    assert.equal(state.itemCount, 10)
  })

  await t.test('a huge playlist is capped at five pages of fifty, and says so with the declared size', async () => {
    const realFetch = globalThis.fetch
    let itemRequests = 0
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input instanceof Request ? input.url : input))
      if (url.hostname !== 'www.googleapis.com') return realFetch(input, init)

      if (url.pathname.endsWith('/playlistItems')) {
        const page = ++itemRequests
        const ids = Array.from({ length: 50 }, (_, i) => `pg${page}id${String(i).padStart(2, '0')}`.slice(0, 11))
        return json({ items: ids.map((id) => ({ snippet: { resourceId: { videoId: id } } })), nextPageToken: `page${page + 1}` })
      }
      if (url.pathname.endsWith('/playlists')) {
        return json({ items: [{ id: PL, snippet: { title: 'Stub playlist' }, contentDetails: { itemCount: 400 } }] })
      }

      const requestedIds = (url.searchParams.get('id') ?? '').split(',').filter(Boolean)
      return json({
        items: requestedIds.map((id) => ({
          id,
          snippet: { title: `Title ${id}`, channelTitle: 'Channel', categoryId: '10', thumbnails: { medium: { url: '' } } },
          contentDetails: { duration: 'PT3M20S' },
          statistics: { viewCount: '1000000' },
          status: { privacyStatus: 'public', embeddable: true, uploadStatus: 'processed' }
        }))
      })
    }

    try {
      updateConfig({ fallbackPlaylist: { playlistId: PL } })
      await fallback.settledConfigReaction(PL)

      assert.equal(itemRequests, 5, 'the page limit stops the walk')
      const state = fallback.getFallbackState()
      assert.equal(state.sourceCount, 250, 'five pages of fifty')
      assert.equal(state.itemCount, 400, 'the declared size still tells the truth about the rest')
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
