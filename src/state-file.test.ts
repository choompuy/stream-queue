import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'streamqueue-test-'))
process.chdir(dir)

const { sanitizeState, sanitizeQueueItem, initState } = await import('./state-file.js')
const queue = await import('./queue.js')
const fallback = await import('./fallback.js')
const { getSettings } = await import('./settings.js')
const { flushAllStores } = await import('./persist.js')

const A = 'aaaaaaaaaaa'
const B = 'bbbbbbbbbbb'
const C = 'ccccccccccc'
const F1 = 'ffffffffff1'
const F2 = 'ffffffffff2'

const song = (videoId: string) => ({ videoId, title: `Track ${videoId[0]}`, channelTitle: 'C', thumbnail: '', duration: 100, views: 1, url: `https://youtu.be/${videoId}` })
// requestedBy = null leaves the field out (a damaged entry)
const item = (videoId: string, requestedBy: string | null = 'viewer') => ({ ...song(videoId), ...(requestedBy === null ? {} : { requestedBy }) })

const goodState = () => ({
  current: item(A),
  queue: [item(B), item(C)],
  settings: { showVideo: true, position: 'top-left', locale: 'ru' },
  fallback: { sourceTracks: [song(F1), song(F2)], order: [F1, F2], cursor: 0, playlistId: 'PLstate0000001', lastRefreshedAt: 5 }
})

test('sanitizeState()', async (t) => {
  await t.test('a healthy state comes through unchanged and without problems', () => {
    const result = sanitizeState(goodState())

    assert.deepEqual(result.problems, [])
    assert.equal(result.current?.videoId, A)
    assert.deepEqual(result.queue.map((entry) => entry.videoId), [B, C])
    assert.deepEqual(result.settings, { showVideo: true, position: 'top-left', locale: 'ru' })
    assert.deepEqual(result.fallback, goodState().fallback)
  })

  await t.test('one bad queue item is dropped and everything else survives', () => {
    const state = { ...goodState(), queue: [item(B), item(C, null), { nonsense: true }, null, 'x'] }
    const result = sanitizeState(state)

    assert.deepEqual(result.queue.map((entry) => entry.videoId), [B])
    assert.equal(result.current?.videoId, A)
    assert.equal(result.settings.locale, 'ru')
    assert.equal(result.fallback?.playlistId, 'PLstate0000001')
    assert.ok(result.problems.some((problem) => problem.includes('dropped 4 invalid')))
  })

  await t.test('duplicates are dropped, including a queued copy of the track that is playing', () => {
    const result = sanitizeState({ ...goodState(), queue: [item(A), item(B), item(B, 'other')] })

    assert.deepEqual(result.queue.map((entry) => entry.videoId), [B])
  })

  await t.test('a fallback track playing now does not hide the same track queued by a viewer', () => {
    const result = sanitizeState({ ...goodState(), current: { ...item(A, 'Playlist'), isFallback: true }, queue: [item(A)] })

    assert.deepEqual(result.queue.map((entry) => entry.videoId), [A])
  })

  await t.test('an invalid current track becomes null', () => {
    assert.equal(sanitizeState({ ...goodState(), current: { videoId: 'x' } }).current, null)
    assert.equal(sanitizeState({ ...goodState(), current: null }).current, null)
  })

  await t.test('invalid settings are ignored one by one', () => {
    const result = sanitizeState({ ...goodState(), settings: { showVideo: 'yes', position: 'top-right', locale: 'xx', junk: 1 } })

    assert.deepEqual(result.settings, { position: 'top-right' })
    assert.ok(result.problems.some((problem) => problem.startsWith('settings:')))
  })

  await t.test('fallback: unknown order ids are dropped and the position reset', () => {
    const state = goodState()
    state.fallback.order = [F1, 'ghost000000', F2]
    const result = sanitizeState(state)

    assert.deepEqual(result.fallback?.order, [F1, F2])
    assert.equal(result.fallback?.cursor, -1)
  })

  await t.test('fallback: out-of-range cursor, bad playlist id and junk tracks are repaired', () => {
    const state = goodState()
    state.fallback.cursor = 99
    state.fallback.playlistId = 'nonsense'
    state.fallback.sourceTracks = [song(F1), { videoId: 'x' } as never, song(F2), song(F2)]
    const result = sanitizeState(state)

    assert.equal(result.fallback?.cursor, -1)
    assert.equal(result.fallback?.playlistId, null)
    assert.deepEqual(result.fallback?.sourceTracks.map((track) => track.videoId), [F1, F2])
  })

  for (const raw of [null, 'x', 5, [], undefined]) {
    await t.test(`a state file that is ${JSON.stringify(raw)} gives empty defaults instead of throwing`, () => {
      const result = sanitizeState(raw)

      assert.equal(result.current, null)
      assert.deepEqual(result.queue, [])
      assert.deepEqual(result.settings, {})
      assert.equal(result.fallback, undefined)
    })
  }

  await t.test('wrong types inside are tolerated', () => {
    const result = sanitizeState({ current: 5, queue: 'x', settings: 'x', fallback: 5 })

    assert.equal(result.current, null)
    assert.deepEqual(result.queue, [])
    assert.deepEqual(result.settings, {})
    assert.equal(result.fallback, undefined)
  })
})

test('sanitizeQueueItem()', async (t) => {
  await t.test('fills missing optional fields with safe defaults', () => {
    const result = sanitizeQueueItem({ videoId: A, title: 'T', requestedBy: ' bob ', duration: 'x', views: -1 })

    assert.deepEqual(result, { videoId: A, title: 'T', channelTitle: '', thumbnail: '', duration: 0, views: 0, url: `https://www.youtube.com/watch?v=${A}`, requestedBy: 'bob' })
  })

  await t.test('needs a valid video id, a title and a requester', () => {
    assert.equal(sanitizeQueueItem({ videoId: 'short', title: 'T', requestedBy: 'x' }), null)
    assert.equal(sanitizeQueueItem({ videoId: A, title: '', requestedBy: 'x' }), null)
    assert.equal(sanitizeQueueItem({ videoId: A, title: 'T', requestedBy: '  ' }), null)
  })
})

test('initState()', async (t) => {
  const stateFile = join(dir, 'cache', 'queue-state.json')
  mkdirSync(join(dir, 'cache'), { recursive: true })

  await t.test('a corrupted item no longer takes the settings and the fallback down with it', () => {
    writeFileSync(stateFile, JSON.stringify({ ...goodState(), queue: [item(B), item(C, null)] }))

    initState()

    assert.equal(queue.getCurrent()?.videoId, A)
    assert.deepEqual(queue.getQueue().map((entry) => entry.videoId), [B])
    assert.deepEqual(getSettings(), { showVideo: true, position: 'top-left', locale: 'ru' })
    assert.equal(fallback.getFallbackSnapshot().playlistId, 'PLstate0000001')
    assert.deepEqual(fallback.getFallbackSnapshot().order, [F1, F2])
  })

  await t.test('later changes are saved to disk', async () => {
    queue.addSong(song(C), 'viewer', true, true)
    await flushAllStores()

    const saved = JSON.parse(readFileSync(stateFile, 'utf8'))
    assert.deepEqual(saved.queue.map((entry: { videoId: string }) => entry.videoId), [B, C])
  })

  await t.test('calling it again neither reloads the file nor registers a second saver', async () => {
    queue.removeAt(0)
    initState()

    assert.deepEqual(queue.getQueue().map((entry) => entry.videoId), [C])
  })
})
