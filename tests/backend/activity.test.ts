import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const { getActivity, clearActivity, logRejection, logAcceptance } = await import('../../src/activity.js')
const { finishItem } = await import('../../src/finish.js')

beforeEach(() => clearActivity())

const last = () => getActivity()[0]

test('activity entry helpers', async (t) => {
  await t.test('logRejection: a request that was refused, with nulls for what is not known', () => {
    logRejection('bob', 'some query', 'SONG_NOT_FOUND')

    assert.deepEqual(
      { ...last(), at: 0 },
      {
        requestedBy: 'bob',
        query: 'some query',
        title: null,
        videoId: null,
        status: 'rejected',
        reasonCode: 'SONG_NOT_FOUND',
        reasonParams: undefined,
        at: 0
      }
    )
  })

  await t.test('logRejection: title, video and reason parameters are kept when known', () => {
    logRejection('bob', 'q', 'VIEWS_TOO_LOW', { title: 'Song', videoId: 'aaaaaaaaaaa', reasonParams: { minViews: 5 } })

    assert.equal(last().title, 'Song')
    assert.equal(last().videoId, 'aaaaaaaaaaa')
    assert.deepEqual(last().reasonParams, { minViews: 5 })
  })

  await t.test('logAcceptance: accepted, with no reason', () => {
    logAcceptance('amy', 'query', 'Song', 'bbbbbbbbbbb')

    assert.equal(last().status, 'accepted')
    assert.equal(last().reasonCode, null)
    assert.equal(last().title, 'Song')
  })

  await t.test('finishItem: a track that could not be played is journaled as failed, attributed to whoever requested it', () => {
    finishItem(
      { videoId: 'ccccccccccc', title: 'Broken', channelTitle: '', thumbnail: '', duration: 1, views: 1, url: 'u', requestedBy: 'zed' },
      { code: 'PLAYBACK_EMBED_DISALLOWED', params: { errorCode: 101 } }
    )

    assert.equal(last().status, 'failed')
    assert.equal(last().requestedBy, 'zed')
    // the title is in `title` already; `query` keeps what identifies the track
    assert.equal(last().query, 'u')
    assert.equal(last().reasonCode, 'PLAYBACK_EMBED_DISALLOWED')
    assert.deepEqual(last().reasonParams, { errorCode: 101 })
  })

  await t.test('finishItem: a blocked track is journaled as a refusal', () => {
    finishItem(
      { videoId: 'ddddddddddd', title: 'Blocked', channelTitle: '', thumbnail: '', duration: 1, views: 1, url: 'u2', requestedBy: 'zed' },
      { code: 'BLOCKED' }
    )

    assert.equal(last().status, 'rejected')
    assert.equal(last().reasonCode, 'BLOCKED')
  })
})

test('the journal of a way out does not need a redemption', async (t) => {
  await t.test('a removed or cleared track writes nothing: the streamer did it on purpose', () => {
    const track = { videoId: 'eeeeeeeeeee', title: 'Gone', channelTitle: '', thumbnail: '', duration: 1, views: 1, url: 'u3', requestedBy: 'zed' }

    finishItem(track, { code: 'TRACK_REMOVED' })
    finishItem(track, { code: 'QUEUE_CLEARED' })
    finishItem(track, 'played')

    assert.deepEqual(getActivity(), [])
  })
})
