import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const { selectBestSong } = await import('../../../src/youtube/index.js')

const song = (videoId: string) => ({ videoId, title: videoId, channelTitle: 'c', thumbnail: '', duration: 200, views: 1, url: videoId })
const A = song('aaaaaaaaaaa')
const B = song('bbbbbbbbbbb')

test('selectBestSong()', async (t) => {
  await t.test('takes the first result of the (already ranked) list', () => {
    assert.equal(selectBestSong([A, B]), A)
  })

  await t.test('skips a result that cannot be requested and takes the next one', () => {
    assert.equal(
      selectBestSong([A, B], (candidate) => candidate.videoId !== A.videoId),
      B
    )
  })

  await t.test('when none can be requested, still returns the first, so the viewer hears the real reason', () => {
    assert.equal(
      selectBestSong([A, B], () => false),
      A
    )
  })

  await t.test('returns null for an empty list', () => {
    assert.equal(selectBestSong([]), null)
  })
})
