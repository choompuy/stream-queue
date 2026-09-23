import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const { getActivity, clearActivity, logRejection, logAcceptance, logFailure } = await import('../../src/activity.js')

beforeEach(() => clearActivity())

const last = () => getActivity()[0]

test('activity entry helpers', async (t) => {
  await t.test('logRejection: a request that was refused, with nulls for what is not known', () => {
    logRejection('bob', 'some query', 'SONG_NOT_FOUND')

    assert.deepEqual({ ...last(), at: 0 }, {
      requestedBy: 'bob',
      query: 'some query',
      title: null,
      videoId: null,
      status: 'rejected',
      reasonCode: 'SONG_NOT_FOUND',
      reasonParams: undefined,
      at: 0
    })
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

  await t.test('logFailure: a queued track that could not be played, attributed to whoever requested it', () => {
    logFailure({ videoId: 'ccccccccccc', title: 'Broken', channelTitle: '', thumbnail: '', duration: 1, views: 1, url: 'u', requestedBy: 'zed' }, 'PLAYBACK_EMBED_DISALLOWED', { errorCode: 101 })

    assert.equal(last().status, 'failed')
    assert.equal(last().requestedBy, 'zed')
    assert.equal(last().query, 'Broken')
    assert.deepEqual(last().reasonParams, { errorCode: 101 })
  })
})
