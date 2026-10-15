import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const queue = await import('../../src/queue.js')
const fallback = await import('../../src/fallback.js')
const { upsertPlaylist, removePlaylist } = await import('../../src/playlists.js')
const { TOPICS, on } = await import('../../src/state-events.js')

// what the panel is told after each change, topic by topic: it reads again what it is told about and nothing else
const heard: string[] = []
for (const topic of TOPICS) on(topic, () => heard.push(topic))
const announced = () => [...new Set(heard)].sort()

const song = (videoId: string) => ({ videoId, title: `Track ${videoId}`, channelTitle: 'Channel', thumbnail: '', duration: 120, views: 100_000, url: `https://youtu.be/${videoId}` })

beforeEach(() => {
  heard.length = 0
})

test('a new current track', async (t) => {
  await t.test('announces the state and the playlist: the playlist shows which of its tracks plays and what comes next', () => {
    queue.setCurrent({ ...song('a'), requestedBy: 'viewer' })

    assert.deepEqual(announced(), ['fallback', 'state'])
  })
})

test('the switches of the playlist', async (t) => {
  for (const [name, toggle] of [
    ['shuffle', fallback.toggleFallbackShuffle],
    ['repeat', fallback.toggleFallbackRepeat],
    ['enabled', fallback.toggleFallbackEnabled]
  ] as const) {
    await t.test(`${name} announces the playlist and the state (what plays next depends on it)`, () => {
      toggle()

      assert.deepEqual(announced(), ['fallback', 'state'])
    })
  }
})

test('removing the active playlist from the rotation', async (t) => {
  await t.test('announces the playlist, the state and the list of saved playlists, whose active mark moved', () => {
    fallback.clearFallback()

    assert.deepEqual(announced(), ['fallback', 'playlists', 'state'])
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
