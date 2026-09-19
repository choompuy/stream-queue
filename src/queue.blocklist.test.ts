import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const queue = await import('./queue.js')
const fallback = await import('./fallback.js')
const blocklist = await import('./blocklist.js')
const { updateConfig } = await import('./config.js')
const { getActivity, clearActivity } = await import('./activity.js')

const song = (videoId: string) => ({
  videoId,
  title: `Track ${videoId}`,
  channelTitle: 'Channel',
  thumbnail: '',
  duration: 120,
  views: 100_000,
  url: `https://youtu.be/${videoId}`
})

const IDS = ['a', 'b', 'c', 'f1', 'f2', 'f3']

function setFallback(ids: string[], repeat = false) {
  fallback.hydrateFallback({ sourceTracks: ids.map(song), order: ids, cursor: -1, playlistId: 'test', lastRefreshedAt: null })
  updateConfig({ fallbackPlaylist: { playlistId: 'test', enabled: true, shuffle: false, repeat } })
}
const enqueue = (...ids: string[]) => ids.forEach((id) => queue.addSong(song(id), 'viewer', true, true))
const block = (...ids: string[]) => ids.forEach((id) => blocklist.blockTrack(id, `Track ${id}`))

beforeEach(() => {
  queue.clearQueue()
  queue.setCurrent(null)
  clearActivity()
  for (const id of IDS) blocklist.unblockTrack(id)
  setFallback([])
})

test('moveToNext() пропускает заблокированные и пишет BLOCKED', () => {
  enqueue('a', 'b', 'c')
  block('a', 'b')
  assert.equal(queue.moveToNext()?.videoId, 'c')
  const blocked = getActivity().filter((e) => e.reasonCode === 'BLOCKED')
  assert.deepEqual(blocked.map((e) => e.videoId).sort(), ['a', 'b'])
})

test('всё заблокировано + repeat: peek и advance возвращают null', () => {
  setFallback(['f1', 'f2'], true)
  block('f1', 'f2')
  assert.equal(fallback.peekNextFallbackTrack(), null)
  assert.equal(fallback.advanceFallback(), null)
})

test('reportPlaybackFailure() пишет failed и переходит к следующему', () => {
  enqueue('b')
  queue.setCurrent({ ...song('a'), requestedBy: 'viewer' })
  queue.reportPlaybackFailure(101)
  assert.equal(queue.getState().current?.videoId, 'b')
  assert.equal(getActivity().find((e) => e.videoId === 'a')?.reasonCode, 'PLAYBACK_EMBED_DISALLOWED')
})
