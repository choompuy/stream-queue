import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const queue = await import('../../src/queue.js')
const player = await import('../../src/player.js')
const fallback = await import('../../src/fallback.js')
const blocklist = await import('../../src/blocklist.js')
const { updateConfig } = await import('../../src/config.js')
const { getActivity, clearActivity } = await import('../../src/activity.js')

const song = (videoId: string) => ({
  videoId,
  title: `Track ${videoId}`,
  channelTitle: 'Channel',
  thumbnail: '',
  duration: 120,
  views: 100_000,
  url: `https://youtu.be/${videoId}`
})

const IDS = ['a', 'b', 'c', 'f1', 'f2', 'f3']

function setFallback(ids: string[], repeat = false) {
  fallback.hydrateFallback({ sourceTracks: ids.map(song), order: ids, cursor: -1, playlistId: 'PLtest0000001', lastRefreshedAt: null })
  updateConfig({ fallbackPlaylist: { playlistId: 'PLtest0000001', enabled: true, shuffle: false, repeat } })
}
const enqueue = (...ids: string[]) => ids.forEach((id) => queue.addSong(song(id), 'viewer', true, true))
const block = (...ids: string[]) => ids.forEach((id) => blocklist.blockTrack(id, `Track ${id}`))

beforeEach(() => {
  queue.clearQueue()
  queue.setCurrent(null)
  clearActivity()
  for (const id of IDS) blocklist.unblockTrack(id)
  setFallback([])
})

const cursor = () => fallback.getFallbackSnapshot().cursor
const playing = (id: string) => queue.setCurrent({ ...song(id), requestedBy: 'viewer' })

test('moveToNext()', async (t) => {
  await t.test('skips blocked tracks in the queue and logs each as BLOCKED, under the requester and title', () => {
    enqueue('a', 'b', 'c')
    block('a', 'b')

    assert.equal(player.moveToNext()?.videoId, 'c')
    assert.equal(player.getState().queue.length, 0)

    const blocked = getActivity().filter((e) => e.reasonCode === 'BLOCKED')
    assert.deepEqual(blocked.map((e) => e.videoId).sort(), ['a', 'b'])
    assert.ok(blocked.every((e) => e.status === 'rejected' && e.requestedBy === 'viewer' && e.title === `Track ${e.videoId}`))
  })

  await t.test('takes the fallback track when only blocked tracks are left in the queue', () => {
    setFallback(['f1', 'f2'])
    enqueue('a')
    block('a')

    assert.equal(player.moveToNext()?.videoId, 'f1')
  })

  await t.test('leaves nothing playing when there is no queue and no fallback', () => {
    playing('a')

    assert.equal(player.moveToNext(), null)
    assert.equal(player.getState().current, null)
  })
})

test('getNextTrack()', async (t) => {
  await t.test('ignores a blocked track at the head of the queue', () => {
    enqueue('a', 'b')
    block('a')

    assert.equal(player.getNextTrack()?.videoId, 'b')
  })

  await t.test('shows the fallback track when the whole queue is blocked', () => {
    setFallback(['f1'])
    enqueue('a')
    block('a')

    assert.equal(player.getNextTrack()?.videoId, 'f1')
  })
})

test('fallback rotation and the blocklist', async (t) => {
  await t.test('peekNextFallbackTrack() skips blocked tracks and does not move the cursor', () => {
    setFallback(['f1', 'f2', 'f3'])
    block('f1')
    const before = cursor()

    assert.equal(fallback.peekNextFallbackTrack()?.videoId, 'f2')
    assert.equal(cursor(), before)
  })

  await t.test('advanceFallback() skips blocked tracks and leaves the cursor on the track that plays', () => {
    setFallback(['f1', 'f2', 'f3'])
    block('f1', 'f2')

    assert.equal(fallback.advanceFallback()?.videoId, 'f3')
    assert.equal(cursor(), 2)
  })

  await t.test('everything blocked + repeat: peek and advance give up instead of looping forever', () => {
    setFallback(['f1', 'f2'], true)
    block('f1', 'f2')

    assert.equal(fallback.peekNextFallbackTrack(), null)
    assert.equal(fallback.advanceFallback(), null)
  })

  await t.test('everything blocked, no repeat: advance keeps returning null', () => {
    setFallback(['f1', 'f2'])
    block('f1', 'f2')

    assert.equal(fallback.advanceFallback(), null)
    assert.equal(fallback.advanceFallback(), null)
    assert.equal(fallback.peekNextFallbackTrack(), null)
  })
})

test('skipIfCurrent()', async (t) => {
  await t.test('skips the playing track when it is the one that was blocked', () => {
    enqueue('b')
    playing('a')

    assert.equal(player.skipIfCurrent('a'), true)
    assert.equal(player.getState().current?.videoId, 'b')
  })

  await t.test('does nothing for any other track', () => {
    playing('a')

    assert.equal(player.skipIfCurrent('zzz'), false)
    assert.equal(player.getState().current?.videoId, 'a')
  })
})

test('reportPlaybackFailure()', async (t) => {
  await t.test('records the failure under the requester and moves on', () => {
    enqueue('b')
    playing('a')

    player.reportPlaybackFailure(101)

    assert.equal(player.getState().current?.videoId, 'b')
    const failed = getActivity().find((e) => e.videoId === 'a')
    assert.equal(failed?.status, 'failed')
    assert.equal(failed?.reasonCode, 'PLAYBACK_EMBED_DISALLOWED')
    assert.equal(failed?.requestedBy, 'viewer')
  })

  await t.test('with nothing left to play, playback stops', () => {
    playing('a')

    player.reportPlaybackFailure(100)

    assert.equal(player.getState().current, null)
  })
})
