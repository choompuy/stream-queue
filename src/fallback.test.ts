import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const fallback = await import('./fallback.js')
const { getConfig, updateConfig } = await import('./config.js')
const { setCurrent } = await import('./queue.js')

const IDS = Array.from({ length: 12 }, (_, i) => `track${String(i).padStart(2, '0')}`)
const song = (videoId: string) => ({ videoId, title: videoId, channelTitle: 'C', thumbnail: '', duration: 100, views: 1, url: `https://youtu.be/${videoId}` })

beforeEach(() => {
  setCurrent(null)
  fallback.hydrateFallback({ sourceTracks: IDS.map(song), order: IDS, cursor: -1, playlistId: 'PLfallbacktest01', lastRefreshedAt: null })
  updateConfig({ fallbackPlaylist: { shuffle: false } })
})

const order = () => fallback.getFallbackSnapshot().order

test('reorderFallback()', async (t) => {
  await t.test('re-orders the rotation without touching the stored shuffle flag', () => {
    fallback.reorderFallback(true)

    assert.notDeepEqual(order(), IDS)
    assert.deepEqual([...order()].sort(), IDS)
    assert.equal(getConfig().fallbackPlaylist.shuffle, false)
  })

  await t.test('back to natural order when shuffle is off', () => {
    fallback.reorderFallback(true)
    fallback.reorderFallback(false)

    assert.deepEqual(order(), IDS)
  })
})

test('toggleFallbackShuffle()', async (t) => {
  await t.test('flips the flag exactly once per call and keeps the order in step with it', () => {
    fallback.toggleFallbackShuffle()
    assert.equal(getConfig().fallbackPlaylist.shuffle, true)
    assert.notDeepEqual(order(), IDS)

    fallback.toggleFallbackShuffle()
    assert.equal(getConfig().fallbackPlaylist.shuffle, false)
    assert.deepEqual(order(), IDS)
  })
})
