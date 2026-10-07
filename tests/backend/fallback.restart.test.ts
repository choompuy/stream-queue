import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A restart of the app with a playlist playing: which track plays now and which one comes next.
const dir = mkdtempSync(join(tmpdir(), 'streamqueue-test-'))
process.chdir(dir)
mkdirSync(join(dir, 'cache'), { recursive: true })

const fallback = await import('../../src/fallback.js')
const { loadState } = await import('../../src/state-file.js')
const queue = await import('../../src/queue.js')
const { updateConfig } = await import('../../src/config.js')
const { updateSecrets } = await import('../../src/secrets.js')

updateSecrets({ youtubeApiKey: 'test-key' })

const PLAYLIST = 'PLrestarttest0001'
const ids = Array.from({ length: 15 }, (_, i) => `trk${String(i).padStart(8, '0')}`)
const song = (videoId: string) => ({ videoId, title: `Title ${videoId}`, channelTitle: 'Channel', thumbnail: '', duration: 200, views: 1_000_000, url: `https://youtu.be/${videoId}` })

// the YouTube answers for a playlist with these videos (the same helper idea as in fallback.refresh.test.ts)
function stubPlaylist(videoIds: string[]): void {
  const realFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input))
    if (url.hostname !== 'www.googleapis.com') return realFetch(input, init)

    if (url.pathname.endsWith('/playlistItems')) {
      return new Response(JSON.stringify({ items: videoIds.map((id) => ({ snippet: { resourceId: { videoId: id } } })) }), { status: 200 })
    }

    const requested = (url.searchParams.get('id') ?? '').split(',').filter(Boolean)
    const items = requested.map((id) => ({
      id,
      snippet: { title: `Title ${id}`, channelTitle: 'Channel', categoryId: '10', thumbnails: { medium: { url: '' } } },
      contentDetails: { duration: 'PT3M20S' },
      statistics: { viewCount: '1000000' },
      status: { privacyStatus: 'public', embeddable: true, uploadStatus: 'processed' }
    }))
    return new Response(JSON.stringify({ items }), { status: 200 })
  }
}

// what the previous run left on disk: track number 9 is playing, the rotation follows the playlist order
function writeSavedState({ withTrackFile }: { withTrackFile: boolean }): void {
  const playing = { ...song(ids[9]), requestedBy: 'Playlist', isFallback: true }
  const fallbackProgress = { order: ids, cursor: 9, playlistId: PLAYLIST, lastRefreshedAt: 1 }

  writeFileSync(join(dir, 'cache', 'queue-state.json'), JSON.stringify({ current: playing, queue: [], fallback: fallbackProgress }))

  if (withTrackFile) writeFileSync(join(dir, 'cache', 'fallback-tracks.json'), JSON.stringify({ sourceTracks: ids.map(song) }))
  else rmSync(join(dir, 'cache', 'fallback-tracks.json'), { force: true })
}

beforeEach(async () => {
  queue.setCurrent(null)
  updateConfig({ fallbackPlaylist: { playlistId: null, enabled: true, repeat: true, shuffle: false } })
  await fallback.refreshFallback() // the "no playlist" branch forgets the rotation of the previous test
  updateConfig({ fallbackPlaylist: { playlistId: PLAYLIST } })
})

async function restart(options: { withTrackFile: boolean; playlist?: string[] }): Promise<void> {
  writeSavedState(options)
  stubPlaylist(options.playlist ?? ids)
  loadState()
  await fallback.refreshFallback() // what startup does
}

const nextId = () => fallback.peekNextFallbackTrack()?.videoId

test('after a restart the playlist goes on from where it was', async (t) => {
  await t.test('with the saved track list (the normal case): 10th track playing, the 11th is next', async () => {
    await restart({ withTrackFile: true })

    assert.equal(queue.getCurrent()?.videoId, ids[9])
    assert.equal(nextId(), ids[10])
  })

  await t.test('without the saved track list: the same, and no track is queued twice', async () => {
    await restart({ withTrackFile: false })

    assert.equal(queue.getCurrent()?.videoId, ids[9])
    assert.equal(nextId(), ids[10])
    assert.deepEqual(fallback.getFallbackProgress().order, ids)
    assert.equal(fallback.getFallbackProgress().cursor, 9)
  })

  await t.test('the playlist changed meanwhile (a track before the playing one removed, one added): the playing track stays, the next is still the next', async () => {
    const edited = [...ids.slice(0, 3), ...ids.slice(4), 'trkNEW00001']
    await restart({ withTrackFile: false, playlist: edited })

    assert.equal(fallback.getFallbackProgress().order[fallback.getFallbackProgress().cursor], ids[9])
    assert.equal(nextId(), ids[10])
    assert.equal(fallback.getFallbackProgress().order.at(-1), 'trkNEW00001')
    assert.equal(new Set(fallback.getFallbackProgress().order).size, fallback.getFallbackProgress().order.length)
  })

  await t.test('a saved position that disagrees with the playing track follows the playing track', async () => {
    writeSavedState({ withTrackFile: true })
    writeFileSync(
      join(dir, 'cache', 'queue-state.json'),
      JSON.stringify({ current: { ...song(ids[9]), requestedBy: 'Playlist', isFallback: true }, queue: [], fallback: { order: ids, cursor: 2, playlistId: PLAYLIST, lastRefreshedAt: 1 } })
    )
    stubPlaylist(ids)
    loadState()

    assert.equal(fallback.getFallbackProgress().cursor, 9)
    assert.equal(nextId(), ids[10])
  })

  await t.test('a track a viewer requested is playing: the playlist keeps its own position', async () => {
    writeSavedState({ withTrackFile: true })
    writeFileSync(
      join(dir, 'cache', 'queue-state.json'),
      JSON.stringify({ current: { ...song('viewerreq01'), requestedBy: 'viewer' }, queue: [], fallback: { order: ids, cursor: 4, playlistId: PLAYLIST, lastRefreshedAt: 1 } })
    )
    stubPlaylist(ids)
    loadState()

    assert.equal(fallback.getFallbackProgress().cursor, 4)
    assert.equal(nextId(), ids[5])
  })
})

test('without any track the position is not used up', async (t) => {
  // without repeat, walking an empty rotation to its end would leave the playlist "finished": that is what must not happen
  t.beforeEach(() => updateConfig({ fallbackPlaylist: { repeat: false } }))

  await t.test('nothing to play: the position stays and the answer is null', () => {
    fallback.hydrateFallback({ sourceTracks: [], order: ids, cursor: 9, playlistId: PLAYLIST, lastRefreshedAt: 1 })

    assert.equal(fallback.advanceFallback(), null)
    assert.equal(fallback.peekNextFallbackTrack(), null)
    assert.equal(fallback.getFallbackProgress().cursor, 9)
  })

  await t.test('and once the tracks are there the rotation goes on from the same place', () => {
    fallback.hydrateFallback({ sourceTracks: [], order: ids, cursor: 9, playlistId: PLAYLIST, lastRefreshedAt: 1 })
    fallback.advanceFallback()

    fallback.hydrateFallback({ sourceTracks: ids.map(song), order: ids, cursor: 9, playlistId: PLAYLIST, lastRefreshedAt: 1 })

    assert.equal(fallback.advanceFallback()?.videoId, ids[10])
  })
})
