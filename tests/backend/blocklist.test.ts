import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const { getBlockedTracks, isBlocked, blockTrack, unblockTrack } = await import('../../src/blocklist.js')

beforeEach(() => {
  for (const track of getBlockedTracks()) unblockTrack(track.videoId)
})

test('blockTrack()', async (t) => {
  await t.test('adds a new entry at the front and marks it blocked', () => {
    blockTrack('aaaaaaaaaaa', 'First')
    blockTrack('bbbbbbbbbbb', 'Second')

    assert.equal(isBlocked('aaaaaaaaaaa'), true)
    assert.equal(isBlocked('bbbbbbbbbbb'), true)
    assert.deepEqual(getBlockedTracks().map((t) => t.videoId), ['bbbbbbbbbbb', 'aaaaaaaaaaa'])
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

  await t.test('over the 100-entry limit, the oldest entries are evicted and forgotten by isBlocked too', () => {
    for (let i = 0; i < 101; i++) blockTrack(`id${String(i).padStart(9, '0')}`, `Track ${i}`)

    const tracks = getBlockedTracks()
    assert.equal(tracks.length, 100)
    // most recently blocked (id100) is kept, the very first one (id000) is evicted
    assert.equal(tracks[0].videoId, 'id000000100')
    assert.equal(isBlocked('id000000000'), false)
    assert.equal(isBlocked('id000000100'), true)
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
