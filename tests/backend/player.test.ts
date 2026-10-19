import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// the modules read data/ and cache/ relative to the working directory: keep the test away from the real ones
process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const player = await import('../../src/player.js')
const queue = await import('../../src/queue.js')
const fallback = await import('../../src/fallback.js')
const { updateConfig } = await import('../../src/config.js')
const { getActivity, clearActivity } = await import('../../src/activity.js')

const song = (videoId: string) => ({
  videoId,
  title: `Track ${videoId[0]}`,
  channelTitle: 'C',
  thumbnail: '',
  duration: 200,
  views: 1,
  url: `https://youtu.be/${videoId}`
})

beforeEach(() => {
  queue.setCurrent(null)
  queue.clearQueue()
  clearActivity()
  fallback.hydrateFallback({ sourceTracks: [], order: [], cursor: -1, playlistId: null, lastRefreshedAt: null })
  updateConfig({ fallbackPlaylist: { enabled: false } })
})

// the YouTube iframe error codes, as they reach the journal
const FAILING_CODES: [number | undefined, string][] = [
  [100, 'PLAYBACK_VIDEO_UNAVAILABLE'],
  [101, 'PLAYBACK_EMBED_DISALLOWED'],
  [150, 'PLAYBACK_EMBED_DISALLOWED'],
  [2, 'PLAYBACK_FAILED'],
  [undefined, 'PLAYBACK_FAILED']
]

test('reportPlaybackFailure() journals why the track could not be played', async (t) => {
  const A = 'aaaaaaaaaaa'

  for (const [errorCode, reason] of FAILING_CODES) {
    await t.test(`error ${errorCode} -> ${reason}`, () => {
      queue.setCurrent({ ...song(A), requestedBy: 'viewer' })

      assert.equal(player.reportPlaybackFailure(errorCode), true)
      assert.equal(getActivity()[0]?.reasonCode, reason)
    })
  }
})

test('reportPlaybackFailure() with nothing playing', async (t) => {
  const A = 'aaaaaaaaaaa'

  await t.test('a stray report does not start the fallback playlist', () => {
    fallback.hydrateFallback({ sourceTracks: [song(A)], order: [A], cursor: -1, playlistId: 'PLq10playtest01', lastRefreshedAt: null })
    updateConfig({ fallbackPlaylist: { enabled: true } })
    queue.setCurrent(null)

    assert.equal(player.reportPlaybackFailure(101), false)
    assert.equal(queue.getCurrent(), null, 'the playlist must not start on its own')
  })

  await t.test('a report about a track that is not playing changes nothing', () => {
    assert.equal(player.reportPlaybackFailure(101, 'bbbbbbbbbbb'), false)
    assert.equal(queue.getCurrent(), null)
    assert.equal(getActivity().length, 0)
  })
})
