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
      return new Response(
        JSON.stringify({ items: ids.map((id) => ({ snippet: { resourceId: { videoId: id } } })) }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
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

test('refreshFallback() reconciliation when the currently-playing fallback track is removed', async (t) => {
  await t.test('continues with the track that came right after the removed one, not whatever now sits at its old index', async () => {
    stubPlaylist([A, B, C, D, E, F])
    updateConfig({ fallbackPlaylist: { playlistId: PL } })
    await fallback.refreshFallback()

    // advance the rotation the same way the real player does (advanceFallback() sets the cursor,
    // setCurrent() is called with its result), so C (the 3rd track) becomes what's actually playing
    advanceTo(3)
    setCurrent({ ...song(C), requestedBy: 'Playlist', isFallback: true })

    stubPlaylist([A, B, D, E, F]) // C removed from the source playlist
    await fallback.refreshFallback()

    assert.equal(fallback.advanceFallback()?.videoId, D, 'D used to come right after C and should still play next')
  })

  await t.test('the removed track was first in the rotation: the next track is unaffected', async () => {
    stubPlaylist([A, B, C])
    updateConfig({ fallbackPlaylist: { playlistId: PL } })
    await fallback.refreshFallback()

    advanceTo(1)
    setCurrent({ ...song(A), requestedBy: 'Playlist', isFallback: true })

    stubPlaylist([B, C])
    await fallback.refreshFallback()

    assert.equal(fallback.advanceFallback()?.videoId, B)
  })

  await t.test('the removed track was last in the rotation: nothing plays next (no repeat)', async () => {
    stubPlaylist([A, B, C])
    updateConfig({ fallbackPlaylist: { playlistId: PL } })
    await fallback.refreshFallback()

    advanceTo(3)
    setCurrent({ ...song(C), requestedBy: 'Playlist', isFallback: true })

    stubPlaylist([A, B])
    await fallback.refreshFallback()

    assert.equal(fallback.advanceFallback(), null)
  })

  await t.test('tracks removed on both sides of the active one: continues with the nearest surviving track after it', async () => {
    stubPlaylist([A, B, C, D, E])
    updateConfig({ fallbackPlaylist: { playlistId: PL } })
    await fallback.refreshFallback()

    advanceTo(3)
    setCurrent({ ...song(C), requestedBy: 'Playlist', isFallback: true })

    stubPlaylist([A, E]) // B, C, D all removed
    await fallback.refreshFallback()

    assert.equal(fallback.advanceFallback()?.videoId, E)
  })

  await t.test('the active track is still in the refreshed playlist: cursor follows it exactly, as before', async () => {
    stubPlaylist([A, B, C, D])
    updateConfig({ fallbackPlaylist: { playlistId: PL } })
    await fallback.refreshFallback()

    advanceTo(2)
    setCurrent({ ...song(B), requestedBy: 'Playlist', isFallback: true })

    stubPlaylist([A, B, C, D, E]) // nothing removed, E added
    await fallback.refreshFallback()

    assert.equal(fallback.advanceFallback()?.videoId, C)
  })
})
