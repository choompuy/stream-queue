import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const queue = await import('../../src/queue.js')
const player = await import('../../src/player.js')
const fallback = await import('../../src/fallback.js')
const { upsertPlaylist, removePlaylist } = await import('../../src/playlists.js')
const { updateConfig } = await import('../../src/config.js')
const { TOPICS, on } = await import('../../src/state-events.js')

// what the panel is told after each change, topic by topic: it reads again what it is told about and nothing else
const heard: string[] = []
for (const topic of TOPICS) on(topic, () => heard.push(topic))
const announced = () => [...new Set(heard)].sort()

const song = (videoId: string) => ({ videoId, title: `Track ${videoId}`, channelTitle: 'Channel', thumbnail: '', duration: 120, views: 100_000, url: `https://youtu.be/${videoId}` })
const IDS = Array.from({ length: 12 }, (_, i) => `track${String(i).padStart(2, '0')}`)

beforeEach(() => {
  queue.setCurrent(null)
  fallback.hydrateFallback({ sourceTracks: IDS.map(song), order: IDS, cursor: -1, playlistId: 'PLannouncetest1', lastRefreshedAt: null })
  updateConfig({ fallbackPlaylist: { shuffle: false, repeat: false, enabled: true } })
  heard.length = 0
})

test('a new current track', async (t) => {
  await t.test('a viewer track announces the state: the playlist view does not depend on it', () => {
    queue.setCurrent({ ...song('viewer000001'), requestedBy: 'viewer' })

    assert.deepEqual(announced(), ['state'])
  })

  await t.test('a playlist track announces the state: the active row follows it, the playlist is not read again', () => {
    queue.setCurrent({ ...song('track01'), requestedBy: 'Playlist', isFallback: true })

    assert.deepEqual(announced(), ['state'])
  })

  await t.test('the same track played again is a new play, announced like one', () => {
    queue.setCurrent({ ...song('track01'), requestedBy: 'Playlist', isFallback: true })
    const firstPlayId = queue.getCurrent()?.playId
    heard.length = 0

    queue.setCurrent({ ...song('track01'), requestedBy: 'Playlist', isFallback: true })

    assert.deepEqual(announced(), ['state'], 'a repeat is a change: the overlay reloads the video')
    assert.notEqual(queue.getCurrent()?.playId, firstPlayId)
  })
})

test('pausing', async (t) => {
  await t.test('announces the state', () => {
    player.setPaused(true)

    assert.deepEqual(announced(), ['state'])
  })

  await t.test('pausing to the same value announces nothing: nothing changed', () => {
    player.setPaused(true)

    assert.deepEqual(announced(), [])
  })
})

test('moving on to the next track', async (t) => {
  await t.test('leaving the old one and taking the next is one state change, announced once', () => {
    queue.setCurrent({ ...song('viewer000001'), requestedBy: 'viewer' })
    queue.addSong(song('viewer000002'), 'viewer', { bypassFilters: true })
    heard.length = 0

    player.moveToNext()

    assert.deepEqual(heard, ['state'])
    assert.equal(queue.getCurrent()?.videoId, 'viewer000002')
  })
})

test('the switches of the playlist', async (t) => {
  for (const [name, toggle] of [
    ['shuffle', fallback.toggleFallbackShuffle],
    ['repeat', fallback.toggleFallbackRepeat],
    ['enabled', fallback.toggleFallbackEnabled]
  ] as const) {
    await t.test(`${name} announces the config, the playlist and the state (what plays next depends on it)`, () => {
      toggle()

      assert.deepEqual(announced(), ['config', 'fallback', 'state'])
    })
  }
})

test('removing the active playlist from the rotation', async (t) => {
  await t.test('announces the playlist and the state: the saved list follows the config, which does not change here', () => {
    fallback.clearFallback()

    assert.deepEqual(announced(), ['fallback', 'state'])
  })
})

test('the saved playlists', async (t) => {
  await t.test('adding one announces the list of playlists and nothing else', () => {
    upsertPlaylist({ id: 'PLsaved00000001', title: 'Saved', thumbnail: '', itemCount: 3 })

    assert.deepEqual(announced(), ['playlists'])
  })

  await t.test('removing one announces the list of playlists and nothing else', () => {
    removePlaylist('PLsaved00000001')

    assert.deepEqual(announced(), ['playlists'])
  })

  await t.test('removing one that is not saved announces nothing: nothing changed', () => {
    removePlaylist('PLnothere000001')

    assert.deepEqual(announced(), [])
  })
})
