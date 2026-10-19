import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const queue = await import('../../src/queue.js')
const { updateConfig } = await import('../../src/config.js')
const { blockTrack, unblockTrack } = await import('../../src/blocklist.js')

const song = (videoId: string) => ({
  videoId,
  title: `Track ${videoId[0]}`,
  channelTitle: 'C',
  thumbnail: '',
  duration: 100,
  views: 1,
  url: 'u'
})

beforeEach(() => {
  queue.clearQueue()
  updateConfig({ maxRequestsPerUser: 1 })
  for (const id of ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd', 'zzzzzzzzzzz']) unblockTrack(id)
})

test('per-user request limit is case-insensitive', async (t) => {
  await t.test('the same user under a different letter case is still counted as one user', () => {
    queue.setCurrent({ ...song('zzzzzzzzzzz'), requestedBy: 'someone' })
    queue.addSong(song('aaaaaaaaaaa'), 'Bob', { bypassFilters: false })

    assert.throws(() => queue.assertCanAddSong(song('bbbbbbbbbbb'), 'bob', { bypassFilters: false }), { code: 'USER_LIMIT' })
    assert.throws(() => queue.assertCanAddSong(song('ccccccccccc'), 'BOB', { bypassFilters: false }), { code: 'USER_LIMIT' })
  })

  await t.test('a different user is not affected by another user being at their limit', () => {
    queue.setCurrent({ ...song('zzzzzzzzzzz'), requestedBy: 'someone' })
    queue.addSong(song('aaaaaaaaaaa'), 'Bob', { bypassFilters: false })

    assert.doesNotThrow(() => queue.assertCanAddSong(song('bbbbbbbbbbb'), 'Amy', { bypassFilters: false }))
  })

  await t.test('removing the one request frees up the slot for any case of the same name', () => {
    queue.setCurrent({ ...song('zzzzzzzzzzz'), requestedBy: 'someone' })
    const added = queue.addSong(song('aaaaaaaaaaa'), 'Bob', { bypassFilters: false }).item
    queue.removeByVideoId(added.videoId)

    assert.doesNotThrow(() => queue.assertCanAddSong(song('bbbbbbbbbbb'), 'BOB', { bypassFilters: false }))
  })
})

test('the track that is playing counts toward the per-user limit', async (t) => {
  await t.test('a viewer whose track is playing is at the limit', () => {
    queue.setCurrent({ ...song('aaaaaaaaaaa'), requestedBy: 'Amy' })

    assert.throws(() => queue.assertCanAddSong(song('bbbbbbbbbbb'), 'amy', { bypassFilters: false }), { code: 'USER_LIMIT' })
    assert.doesNotThrow(() => queue.assertCanAddSong(song('bbbbbbbbbbb'), 'Bob', { bypassFilters: false }))
  })

  await t.test('a request that starts playing at once counts as well', () => {
    queue.setCurrent(null)
    const { started } = queue.addSong(song('aaaaaaaaaaa'), 'Cy', { bypassFilters: false })

    assert.equal(started, true)
    assert.throws(() => queue.assertCanAddSong(song('bbbbbbbbbbb'), 'cy', { bypassFilters: false }), { code: 'USER_LIMIT' })
  })

  await t.test('the playing track and the queued ones are counted together', () => {
    updateConfig({ maxRequestsPerUser: 2 })
    queue.setCurrent({ ...song('aaaaaaaaaaa'), requestedBy: 'Amy' })

    assert.doesNotThrow(() => queue.addSong(song('bbbbbbbbbbb'), 'Amy', { bypassFilters: false }))
    assert.throws(() => queue.assertCanAddSong(song('ccccccccccc'), 'Amy', { bypassFilters: false }), { code: 'USER_LIMIT' })
  })

  await t.test('the place is free again when the playing track is gone', () => {
    queue.setCurrent({ ...song('aaaaaaaaaaa'), requestedBy: 'Amy' })
    assert.throws(() => queue.assertCanAddSong(song('bbbbbbbbbbb'), 'Amy', { bypassFilters: false }), { code: 'USER_LIMIT' })

    queue.setCurrent(null)

    assert.doesNotThrow(() => queue.assertCanAddSong(song('bbbbbbbbbbb'), 'Amy', { bypassFilters: false }))
  })

  await t.test('a track of the fallback playlist is nobody\'s request', () => {
    queue.setCurrent({ ...song('aaaaaaaaaaa'), requestedBy: 'Playlist', isFallback: true })

    assert.doesNotThrow(() => queue.assertCanAddSong(song('bbbbbbbbbbb'), 'Playlist', { bypassFilters: false }))
  })

  await t.test('a playlist track waiting in the queue is nobody\'s request either', () => {
    queue.setCurrent({ ...song('zzzzzzzzzzz'), requestedBy: 'someone' })
    queue.addSong(song('aaaaaaaaaaa'), 'playlist', { bypassFilters: false, isFallback: true })

    assert.doesNotThrow(() => queue.assertCanAddSong(song('bbbbbbbbbbb'), 'playlist', { bypassFilters: false }))
  })

  await t.test('a track the streamer blocked frees the viewer\'s slot: it never plays', () => {
    queue.setCurrent({ ...song('zzzzzzzzzzz'), requestedBy: 'someone' })
    queue.addSong(song('aaaaaaaaaaa'), 'Bob', { bypassFilters: false })
    blockTrack('aaaaaaaaaaa', 'Track a')

    assert.doesNotThrow(() => queue.assertCanAddSong(song('bbbbbbbbbbb'), 'bob', { bypassFilters: false }))
  })
})

test('blocked tracks do not occupy the queue size', async (t) => {
  t.beforeEach(() => {
    queue.clearQueue()
    updateConfig({ maxRequestsPerUser: 1, maxQueueSize: 1 })
    for (const id of ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'zzzzzzzzzzz']) unblockTrack(id)
  })

  await t.test('a queue full of blocked tracks still takes a request', () => {
    queue.setCurrent({ ...song('zzzzzzzzzzz'), requestedBy: 'someone' })
    queue.addSong(song('aaaaaaaaaaa'), 'Bob', { bypassFilters: true })
    blockTrack('aaaaaaaaaaa', 'Track a')

    assert.doesNotThrow(() => queue.addSong(song('bbbbbbbbbbb'), 'Amy', { bypassFilters: true }))

    // one playable track is the limit here
    assert.throws(() => queue.assertCanAddSong(song('ccccccccccc'), 'Cy', { bypassFilters: true }), { code: 'QUEUE_FULL' })
  })
})
