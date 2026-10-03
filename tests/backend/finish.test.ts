import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// data/ and cache/ are read relative to the working directory: keep the test away from the real ones
process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const { registerRedemptionHandler } = await import('../../src/finish.js')
const queue = await import('../../src/queue.js')
const player = await import('../../src/player.js')
const { blockTrack, unblockTrack } = await import('../../src/blocklist.js')
const { sanitizeQueueItem } = await import('../../src/state-file.js')

const song = (videoId: string) => ({
  videoId,
  title: `Track ${videoId[0]}`,
  channelTitle: 'c',
  thumbnail: '',
  duration: 200,
  views: 1,
  url: `https://youtu.be/${videoId}`
})
// a redemption id is closed once for the life of the process, so every test uses ids of its own
let run = 0
const redemption = (id: string) => ({ id: `${id}#${run}`, rewardId: 'reward', userName: 'viewer' })
const tag = (id: string) => `${id}#${run}`
const A = 'aaaaaaaaaaa'
const B = 'bbbbbbbbbbb'
const C = 'ccccccccccc'
const D = 'ddddddddddd'

let outcomes: string[] = []
registerRedemptionHandler((tracked, outcome) =>
  outcomes.push(`${tracked.id}:${outcome.status === 'succeeded' ? 'FULFILLED' : `CANCELED/${outcome.reason.code}`}`)
)

function reset(): void {
  queue.clearQueue()
  queue.setCurrent(null)
  outcomes = []
  unblockTrack(A)
  run++
}

const add = (videoId: string, id: string) => queue.addSong(song(videoId), `user-${id}`, { channelPointsRedemption: redemption(id) })

test('a Channel Points redemption is closed by the way its track leaves', async (t) => {
  t.beforeEach(reset)

  await t.test('removing it from the queue refunds the points', () => {
    add(A, 'r1')
    queue.removeByVideoId(A)
    assert.deepEqual(outcomes, [`${tag('r1')}:CANCELED/TRACK_REMOVED`])
  })

  await t.test('clearing the queue refunds every redemption in it', () => {
    add(A, 'r1')
    add(B, 'r2')
    queue.clearQueue()
    assert.deepEqual(outcomes, [`${tag('r1')}:CANCELED/QUEUE_CLEARED`, `${tag('r2')}:CANCELED/QUEUE_CLEARED`])
  })

  await t.test('a queued track that was blocked afterwards is refunded when its turn comes', () => {
    queue.setCurrent({ ...song(D), requestedBy: 'someone' })
    add(A, 'r1')
    blockTrack(A, 'Track a')

    player.moveToNext()

    assert.deepEqual(outcomes, [`${tag('r1')}:CANCELED/BLOCKED`])
  })

  await t.test('playing to the end fulfils it', () => {
    queue.setCurrent({ ...song(A), requestedBy: 'user', channelPointsRedemption: redemption('r1') })
    player.endCurrent(A)
    assert.deepEqual(outcomes, [`${tag('r1')}:FULFILLED`])
  })

  await t.test('skipping the current track leaves the decision to the streamer: nothing is closed', () => {
    queue.setCurrent({ ...song(A), requestedBy: 'user', channelPointsRedemption: redemption('r1') })
    player.skipCurrent()
    assert.deepEqual(outcomes, [])
  })

  await t.test('a redemption is closed only once', () => {
    const item = { ...song(A), requestedBy: 'user', channelPointsRedemption: redemption('r1') }
    queue.setCurrent(item)
    player.endCurrent(A)
    queue.setCurrent(item)
    player.endCurrent(A)
    assert.deepEqual(outcomes, [`${tag('r1')}:FULFILLED`])
  })

  await t.test('a track without a redemption is ignored', () => {
    queue.addSong(song(A), 'chatter')
    queue.removeByVideoId(A)
    assert.deepEqual(outcomes, [])
  })
})

test('removeByVideoId()', async (t) => {
  t.beforeEach(reset)

  await t.test('removes the track with that id even after the queue shifted', () => {
    queue.setCurrent({ ...song(D), requestedBy: 'someone' })
    add(A, 'r1')
    add(B, 'r2')
    add(C, 'r3')
    queue.shiftQueue() // A started playing: B is now at index 0, where A was a moment ago

    assert.equal(queue.removeByVideoId(C)?.videoId, C)
    assert.deepEqual(
      queue.getQueue().map((item) => item.videoId),
      [B]
    )
  })

  await t.test('an id that is not in the queue removes nothing', () => {
    add(A, 'r1')
    assert.equal(queue.removeByVideoId(B), null)
    assert.equal(queue.getQueue().length, 1)
  })
})

test('the redemption survives a restart', () => {
  const restored = sanitizeQueueItem({ ...song(A), requestedBy: 'user', channelPointsRedemption: redemption('r1') })
  assert.deepEqual(restored?.channelPointsRedemption, redemption('r1'))
})

test('a damaged redemption is dropped, the track is kept', () => {
  const restored = sanitizeQueueItem({ ...song(A), requestedBy: 'user', channelPointsRedemption: { id: 'r1' } })
  assert.equal(restored?.videoId, A)
  assert.equal(restored?.channelPointsRedemption, undefined)
})
