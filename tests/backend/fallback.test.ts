import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// the playlist's requester name comes from the real locale files
// (copied, not symlinked: creating a symlink needs extra privileges on Windows)
const workDir = mkdtempSync(join(tmpdir(), 'streamqueue-test-'))
cpSync(resolve('public/locales'), join(workDir, 'public/locales'), { recursive: true })
process.chdir(workDir)

const fallback = await import('../../src/fallback.js')
const { getConfig, updateConfig } = await import('../../src/config.js')
const { setCurrent } = await import('../../src/queue.js')
const { on } = await import('../../src/state-events.js')
const { updateSettings } = await import('../../src/settings.js')

const IDS = Array.from({ length: 12 }, (_, i) => `track${String(i).padStart(2, '0')}`)
const song = (videoId: string) => ({
  videoId,
  title: videoId,
  channelTitle: 'C',
  thumbnail: '',
  duration: 100,
  views: 1,
  url: `https://youtu.be/${videoId}`
})

beforeEach(() => {
  setCurrent(null)
  fallback.hydrateFallback({ sourceTracks: IDS.map(song), order: IDS, cursor: -1, playlistId: 'PLfallbacktest01', lastRefreshedAt: null })
  updateConfig({ fallbackPlaylist: { shuffle: false } })
})

const order = () => fallback.getFallbackProgress().order

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

test('state persistence hooks', async (t) => {
  function countNotifications(action: () => void): number {
    let count = 0
    const off = on('state', () => count++)
    action()
    off()
    return count
  }

  await t.test('re-ordering the rotation is announced so it gets saved', () => {
    assert.equal(
      countNotifications(() => fallback.reorderFallback(true)),
      1
    )
  })

  await t.test('toggling shuffle is announced once', () => {
    assert.equal(
      countNotifications(() => fallback.toggleFallbackShuffle()),
      1
    )
  })

  await t.test('clearing the fallback is announced, and leaves nothing to be saved but the empty state', () => {
    assert.equal(
      countNotifications(() => fallback.clearFallback()),
      1
    )
    assert.deepEqual(fallback.getFallbackProgress().order, [])
    assert.equal(fallback.getFallbackProgress().playlistId, null)
  })
})

test('the tracks the playlist itself queues', async (t) => {
  await t.test('queueFallbackTrack() marks the track as the playlist\'s own', () => {
    setCurrent({ ...song('playing000001'), requestedBy: 'viewer' })

    const item = fallback.queueFallbackTrack('track00')

    assert.equal(item?.isFallback, true)
    assert.equal(item?.requestedBy, 'Playlist')
    assert.equal(fallback.queueFallbackTrack('nosuchtrack00'), null)
  })

  await t.test('the name follows the locale', async () => {
    updateSettings({ locale: 'ru' })
    setCurrent({ ...song('playing000001'), requestedBy: 'viewer' })

    assert.equal(fallback.queueFallbackTrack('track05')?.requestedBy, 'Плейлист')
    assert.equal(fallback.advanceFallback()?.requestedBy, 'Плейлист')

    updateSettings({ locale: 'en' })
    assert.equal(fallback.peekNextFallbackTrack()?.requestedBy, 'Playlist')
  })
})
