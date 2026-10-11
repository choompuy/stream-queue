import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const queue = await import('../../src/queue.js')
const { updateConfig } = await import('../../src/config.js')

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
})

test('per-user request limit is case-insensitive', async (t) => {
  await t.test('the same user under a different letter case is still counted as one user', () => {
    queue.setCurrent({ ...song('zzzzzzzzzzz'), requestedBy: 'someone' })
    queue.addSong(song('aaaaaaaaaaa'), 'Bob', { bypassLimits: false })

    assert.throws(() => queue.assertCanAddSong(song('bbbbbbbbbbb'), 'bob', { bypassLimits: false }), { code: 'USER_LIMIT' })
    assert.throws(() => queue.assertCanAddSong(song('ccccccccccc'), 'BOB', { bypassLimits: false }), { code: 'USER_LIMIT' })
  })

  await t.test('a different user is not affected by another user being at their limit', () => {
    queue.setCurrent({ ...song('zzzzzzzzzzz'), requestedBy: 'someone' })
    queue.addSong(song('aaaaaaaaaaa'), 'Bob', { bypassLimits: false })

    assert.doesNotThrow(() => queue.assertCanAddSong(song('bbbbbbbbbbb'), 'Amy', { bypassLimits: false }))
  })

  await t.test('removing the one request frees up the slot for any case of the same name', () => {
    queue.setCurrent({ ...song('zzzzzzzzzzz'), requestedBy: 'someone' })
    const added = queue.addSong(song('aaaaaaaaaaa'), 'Bob', { bypassLimits: false }).item
    queue.removeAt(queue.getQueue().indexOf(added))

    assert.doesNotThrow(() => queue.assertCanAddSong(song('bbbbbbbbbbb'), 'BOB', { bypassLimits: false }))
  })
})

test('the track that is playing counts toward the per-user limit', async (t) => {
  await t.test('a viewer whose track is playing is at the limit', () => {
    queue.setCurrent({ ...song('aaaaaaaaaaa'), requestedBy: 'Amy' })

    assert.throws(() => queue.assertCanAddSong(song('bbbbbbbbbbb'), 'amy', { bypassLimits: false }), { code: 'USER_LIMIT' })
    assert.doesNotThrow(() => queue.assertCanAddSong(song('bbbbbbbbbbb'), 'Bob', { bypassLimits: false }))
  })

  await t.test('a request that starts playing at once counts as well', () => {
    queue.setCurrent(null)
    const { started } = queue.addSong(song('aaaaaaaaaaa'), 'Cy', { bypassLimits: false })

    assert.equal(started, true)
    assert.throws(() => queue.assertCanAddSong(song('bbbbbbbbbbb'), 'cy', { bypassLimits: false }), { code: 'USER_LIMIT' })
  })

  await t.test('the playing track and the queued ones are counted together', () => {
    updateConfig({ maxRequestsPerUser: 2 })
    queue.setCurrent({ ...song('aaaaaaaaaaa'), requestedBy: 'Amy' })

    assert.doesNotThrow(() => queue.addSong(song('bbbbbbbbbbb'), 'Amy', { bypassLimits: false }))
    assert.throws(() => queue.assertCanAddSong(song('ccccccccccc'), 'Amy', { bypassLimits: false }), { code: 'USER_LIMIT' })
  })

  await t.test('the place is free again when the playing track is gone', () => {
    queue.setCurrent({ ...song('aaaaaaaaaaa'), requestedBy: 'Amy' })
    assert.throws(() => queue.assertCanAddSong(song('bbbbbbbbbbb'), 'Amy', { bypassLimits: false }), { code: 'USER_LIMIT' })

    queue.setCurrent(null)

    assert.doesNotThrow(() => queue.assertCanAddSong(song('bbbbbbbbbbb'), 'Amy', { bypassLimits: false }))
  })

  await t.test('a track of the fallback playlist is nobody\'s request', () => {
    queue.setCurrent({ ...song('aaaaaaaaaaa'), requestedBy: 'Playlist', isFallback: true })

    assert.doesNotThrow(() => queue.assertCanAddSong(song('bbbbbbbbbbb'), 'Playlist', { bypassLimits: false }))
  })
})
