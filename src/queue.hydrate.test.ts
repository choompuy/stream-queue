import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const queue = await import('./queue.js')
const { updateConfig } = await import('./config.js')

const item = (videoId: string, requestedBy = 'viewer') => ({ videoId, title: `Track ${videoId[0]}`, channelTitle: 'C', thumbnail: '', duration: 100, views: 1, url: 'u', requestedBy })

test('hydrateQueue()', async (t) => {
  await t.test('replaces the queue, the current track and the per-user counts', () => {
    queue.hydrateQueue({ current: item('aaaaaaaaaaa'), queue: [item('bbbbbbbbbbb', 'Bob'), item('ccccccccccc', 'bob')] })

    assert.equal(queue.getCurrent()?.videoId, 'aaaaaaaaaaa')
    assert.deepEqual(queue.getQueue().map((entry) => entry.videoId), ['bbbbbbbbbbb', 'ccccccccccc'])

    queue.hydrateQueue({ current: null, queue: [item('ddddddddddd', 'Amy')] })
    assert.deepEqual(queue.getQueue().map((entry) => entry.videoId), ['ddddddddddd'])
    // Bob's two old entries are forgotten: with a limit of one request per user he may queue again
    updateConfig({ maxRequestsPerUser: 1 })
    assert.doesNotThrow(() => queue.assertCanAddSong(item('eeeeeeeeeee'), 'Bob', true, false))
    assert.throws(() => queue.assertCanAddSong(item('fffffffffff'), 'Amy', true, false), { code: 'USER_LIMIT' })
  })

  await t.test('a saved "nothing is playing" clears the current track instead of keeping the old one', () => {
    queue.setCurrent(item('aaaaaaaaaaa'))

    queue.hydrateQueue({ current: null, queue: [] })

    assert.equal(queue.getCurrent(), null)
  })

  await t.test('an absent current is left alone', () => {
    queue.setCurrent(item('aaaaaaaaaaa'))

    queue.hydrateQueue({ queue: [] })

    assert.equal(queue.getCurrent()?.videoId, 'aaaaaaaaaaa')
  })
})
