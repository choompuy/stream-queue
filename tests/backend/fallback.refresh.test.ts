import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const fallback = await import('../../src/fallback.js')
const { updateConfig } = await import('../../src/config.js')
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

// stubs the YouTube "playlistItems" and "videos" endpoints that fetchPlaylistSongs() calls internally
function stubPlaylist(ids: string[]) {
  const realFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input))
    if (url.hostname !== 'www.googleapis.com') return realFetch(input, init)

    if (url.pathname.endsWith('/playlistItems')) {
      return new Response(JSON.stringify({ items: ids.map((id) => ({ snippet: { resourceId: { videoId: id } } })) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
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
    return new Response(JSON.stringify({ items }), { status: 200, headers: { 'Content-Type': 'application/json' } })
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
  await fallback.refreshFallback() // actually clears loadedFallbackPlaylistId via the "no playlist" branch
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
    await fallback.refreshFallback()

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
    await fallback.refreshFallback()

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
    await fallback.refreshFallback()

    advanceTo(2)
    setCurrent({ ...song(B), requestedBy: 'Playlist', isFallback: true })

    stubPlaylist([A, B, C, D, E]) // nothing removed, E added
    await fallback.refreshFallback()

    // B is still in the playlist, the rest is reshuffled around it
    const order = fallback.getFallbackProgress().order
    assert.equal(order[0], B, 'playing track stays first')
    assert.deepEqual(order.slice(1).sort(), [A, C, D, E], 'the rest are all present')
  })
})
