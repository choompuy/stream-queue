import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Files edited by hand (or left by an older version) are written BEFORE the modules are imported: they are read on first use
process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))
mkdirSync('data')

const GOOD_ID = 'dQw4w9WgXcQ'

writeFileSync(
  'data/blocklist.json',
  JSON.stringify([
    { videoId: GOOD_ID, title: 'kept', blockedAt: 1700000000000 },
    { videoId: 'not an id', title: 'bad id', blockedAt: 1 },
    { videoId: 'aaaaaaaaaaa', title: 'bad time', blockedAt: 'yesterday' },
    { videoId: 5 },
    'text',
    null
  ])
)

// valid JSON, but not a list
writeFileSync('data/playlists.json', JSON.stringify({ playlists: [] }))

const entry = (n: number) => ({ requestedBy: `user${n}`, query: `q${n}`, title: null, videoId: null, status: 'rejected', reasonCode: 'DUPLICATE', at: 1700000000000 + n })
writeFileSync('data/activity.json', JSON.stringify([...Array.from({ length: 105 }, (_, n) => entry(n)), { requestedBy: 7 }, 'text']))

const { getBlockedTracks, isBlocked, blockTrack } = await import('../../src/blocklist.js')
const { getPlaylists, upsertPlaylist } = await import('../../src/playlists.js')
const { getActivity, logActivity } = await import('../../src/activity.js')

test('files that hold a list go through the same check as the config', async (t) => {
  await t.test('the blocklist keeps the valid tracks and drops the rest', () => {
    assert.deepEqual(
      getBlockedTracks().map((track) => track.videoId),
      [GOOD_ID]
    )
    assert.equal(isBlocked(GOOD_ID), true)
    assert.equal(isBlocked('aaaaaaaaaaa'), false)
    assert.doesNotThrow(() => blockTrack('bbbbbbbbbbb', 'new'))
  })

  await t.test('a file that is not a list is an empty list, and the code on top of it works', () => {
    assert.deepEqual(getPlaylists(), [])

    upsertPlaylist({ id: 'PL123', title: 'first', thumbnail: '', itemCount: 3 })
    assert.equal(getPlaylists().length, 1)
  })

  await t.test('the activity keeps the valid entries up to its limit, the newest first as they were saved', () => {
    const list = getActivity()

    assert.equal(list.length, 100)
    assert.equal(list[0].requestedBy, 'user0')

    logActivity({ requestedBy: 'new', query: 'q', title: null, videoId: null, status: 'rejected', reasonCode: null })
    assert.equal(getActivity()[0].requestedBy, 'new')
    assert.equal(getActivity().length, 100)
  })
})
