import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const { getBlockedTracks, isBlocked, blockTrack, unblockTrack, markBlocked } = await import('../../src/blocklist.js')
const { on } = await import('../../src/state-events.js')
const { hydrateFallback } = await import('../../src/fallback.js')

const song = (videoId: string) => ({ videoId, title: `Track ${videoId}`, channelTitle: 'Channel', thumbnail: '', duration: 120, views: 100_000, url: `https://youtu.be/${videoId}` })

beforeEach(() => {
  for (const track of getBlockedTracks()) unblockTrack(track.videoId)
})

test('blockTrack()', async (t) => {
  await t.test('adds a new entry at the front and marks it blocked', () => {
    blockTrack('aaaaaaaaaaa', 'First')
    blockTrack('bbbbbbbbbbb', 'Second')

    assert.equal(isBlocked('aaaaaaaaaaa'), true)
    assert.equal(isBlocked('bbbbbbbbbbb'), true)
    assert.deepEqual(
      getBlockedTracks().map((t) => t.videoId),
      ['bbbbbbbbbbb', 'aaaaaaaaaaa']
    )
  })

  await t.test('blocking the same id again is a no-op: no duplicate, no updated title or timestamp', () => {
    blockTrack('aaaaaaaaaaa', 'Original title')
    const first = getBlockedTracks()[0]

    blockTrack('aaaaaaaaaaa', 'A different title')
    const tracks = getBlockedTracks()

    assert.equal(tracks.length, 1)
    assert.equal(tracks[0].title, 'Original title')
    assert.equal(tracks[0].blockedAt, first.blockedAt)
  })

  await t.test('the title is trimmed and capped to 200 characters', () => {
    blockTrack('aaaaaaaaaaa', `  ${'x'.repeat(250)}  `)

    assert.equal(getBlockedTracks()[0].title.length, 200)
    assert.equal(getBlockedTracks()[0].title, 'x'.repeat(200))
  })

  await t.test('an empty or whitespace-only title falls back to the videoId', () => {
    blockTrack('aaaaaaaaaaa', '   ')
    assert.equal(getBlockedTracks()[0].title, 'aaaaaaaaaaa')
  })

  await t.test('returns the stored entry, including on a repeat call for the same id', () => {
    const first = blockTrack('aaaaaaaaaaa', 'Title')
    const second = blockTrack('aaaaaaaaaaa', 'Ignored title')

    assert.deepEqual(first, second)
    assert.equal(second.title, 'Title')
  })

  await t.test('over the 1000-entry limit, the oldest entries are evicted and forgotten by isBlocked too', () => {
    for (let i = 0; i < 1001; i++) blockTrack(`id${String(i).padStart(9, '0')}`, `Track ${i}`)

    const tracks = getBlockedTracks()
    assert.equal(tracks.length, 1000)
    // most recently blocked (id1000) is kept, the very first one (id000) is evicted
    assert.equal(tracks[0].videoId, 'id000001000')
    assert.equal(isBlocked('id000000000'), false)
    assert.equal(isBlocked('id000001000'), true)
  })
})

test('unblockTrack()', async (t) => {
  await t.test('removes the entry and clears isBlocked', () => {
    blockTrack('aaaaaaaaaaa', 'Title')

    assert.equal(unblockTrack('aaaaaaaaaaa'), true)
    assert.equal(isBlocked('aaaaaaaaaaa'), false)
    assert.equal(getBlockedTracks().length, 0)
  })

  await t.test('an id that was never blocked returns false and changes nothing', () => {
    blockTrack('aaaaaaaaaaa', 'Title')

    assert.equal(unblockTrack('zzzzzzzzzzz'), false)
    assert.equal(getBlockedTracks().length, 1)
  })

  await t.test('unblocking twice: the second call returns false', () => {
    blockTrack('aaaaaaaaaaa', 'Title')

    assert.equal(unblockTrack('aaaaaaaaaaa'), true)
    assert.equal(unblockTrack('aaaaaaaaaaa'), false)
  })

  await t.test('after unblocking, the id can be blocked again as a fresh entry', () => {
    blockTrack('aaaaaaaaaaa', 'Original')
    unblockTrack('aaaaaaaaaaa')
    blockTrack('aaaaaaaaaaa', 'New title')

    assert.equal(getBlockedTracks()[0].title, 'New title')
  })
})

test('getBlockedTracks()', async (t) => {
  await t.test('returns a copy: mutating the result does not change the stored list', () => {
    blockTrack('aaaaaaaaaaa', 'Title')
    const tracks = getBlockedTracks()
    tracks.pop()

    assert.equal(getBlockedTracks().length, 1)
  })
})

test('markBlocked()', async (t) => {
  await t.test('says for every track whether it is blocked, and keeps the rest of the track as it is', () => {
    blockTrack('aaaaaaaaaaa', 'First')
    const tracks = [
      { videoId: 'aaaaaaaaaaa', title: 'First' },
      { videoId: 'bbbbbbbbbbb', title: 'Second' }
    ]

    assert.deepEqual(markBlocked(tracks), [
      { videoId: 'aaaaaaaaaaa', title: 'First', isBlocked: true },
      { videoId: 'bbbbbbbbbbb', title: 'Second', isBlocked: false }
    ])
    assert.equal('isBlocked' in tracks[0], false, 'the tracks that were given are not changed')
  })
})

test('what a change of the blocklist announces', async (t) => {
  const heard: string[] = []
  const offs = (['blocklist', 'state', 'fallback', 'activity'] as const).map((topic) => on(topic, () => heard.push(topic)))
  t.after(() => offs.forEach((off) => off()))
  beforeEach(() => {
    heard.length = 0
  })

  // the playlist view carries the blocked marks of its rotation, so a track of the rotation changes it
  hydrateFallback({ sourceTracks: [song('aaaaaaaaaaa')], order: ['aaaaaaaaaaa'], cursor: -1, playlistId: null, lastRefreshedAt: null })

  await t.test('blocking a track of the rotation announces the list, the queue and the playlist: all three show it', () => {
    blockTrack('aaaaaaaaaaa', 'First')

    assert.deepEqual(heard.sort(), ['blocklist', 'fallback', 'state'])
  })

  await t.test('blocking a track outside the rotation does not wake the playlist tab: its view did not change', () => {
    blockTrack('outside00001', 'Outside')

    assert.deepEqual(heard.sort(), ['blocklist', 'state'])
  })

  await t.test('blocking a track that is blocked already announces nothing: nothing changed', () => {
    blockTrack('aaaaaaaaaaa', 'First')
    heard.length = 0

    blockTrack('aaaaaaaaaaa', 'First again')

    assert.deepEqual(heard, [])
  })

  await t.test('unblocking announces the same three, unblocking a track that is not blocked announces nothing', () => {
    blockTrack('aaaaaaaaaaa', 'First')
    heard.length = 0

    unblockTrack('aaaaaaaaaaa')
    assert.deepEqual(heard.sort(), ['blocklist', 'fallback', 'state'])

    heard.length = 0
    unblockTrack('aaaaaaaaaaa')
    assert.deepEqual(heard, [])
  })
})
