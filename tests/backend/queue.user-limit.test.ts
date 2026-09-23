import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const queue = await import('../../src/queue.js')
const { updateConfig } = await import('../../src/config.js')

const song = (videoId: string) => ({ videoId, title: `Track ${videoId[0]}`, channelTitle: 'C', thumbnail: '', duration: 100, views: 1, url: 'u' })

beforeEach(() => {
  queue.clearQueue()
  updateConfig({ maxRequestsPerUser: 1 })
})

test('per-user request limit is case-insensitive', async (t) => {
  await t.test('the same user under a different letter case is still counted as one user', () => {
    queue.addSong(song('aaaaaaaaaaa'), 'Bob', true, false)

    assert.throws(() => queue.assertCanAddSong(song('bbbbbbbbbbb'), 'bob', true, false), { code: 'USER_LIMIT' })
    assert.throws(() => queue.assertCanAddSong(song('ccccccccccc'), 'BOB', true, false), { code: 'USER_LIMIT' })
  })

  await t.test('a different user is not affected by another user being at their limit', () => {
    queue.addSong(song('aaaaaaaaaaa'), 'Bob', true, false)

    assert.doesNotThrow(() => queue.assertCanAddSong(song('bbbbbbbbbbb'), 'Amy', true, false))
  })

  await t.test('removing the one request frees up the slot for any case of the same name', () => {
    const added = queue.addSong(song('aaaaaaaaaaa'), 'Bob', true, false)
    queue.removeAt(queue.getQueue().indexOf(added))

    assert.doesNotThrow(() => queue.assertCanAddSong(song('bbbbbbbbbbb'), 'BOB', true, false))
  })
})
