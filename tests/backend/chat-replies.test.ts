import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// the modules read data/ and cache/ relative to the working directory: keep the test away from the real ones,
// but give it the real locale files (the texts under test live there)
// (copied, not symlinked: creating a symlink needs extra privileges on Windows)
const locales = resolve('public/locales')
const workDir = mkdtempSync(join(tmpdir(), 'streamqueue-test-'))
cpSync(locales, join(workDir, 'public/locales'), { recursive: true })
process.chdir(workDir)

const { buildRedemptionAcceptedMessage, buildRedemptionRejectionMessage, buildQueueMessage } = await import('../../src/chat-replies.js')

test('buildQueueMessage', async (t) => {
  const track = (videoId: string, isBlocked = false) => ({ videoId, title: `Track ${videoId}`, requestedBy: 'viewer', isBlocked })

  await t.test('lists the first titles and counts everything', () => {
    const message = buildQueueMessage({ queue: [track('a'), track('b')] }, 'en')

    assert.equal(message, 'Queue [2]: 1. Track a | 2. Track b')
  })

  await t.test('blocked tracks are not upcoming: not listed, not counted', () => {
    const message = buildQueueMessage({ queue: [track('a', true), track('b'), track('c', true)] }, 'en')

    assert.equal(message, 'Queue [1]: 1. Track b')
  })

  await t.test('a queue with nothing but blocked tracks reads as empty', () => {
    const message = buildQueueMessage({ queue: [track('a', true)] }, 'en')

    assert.equal(message, 'The queue is empty')
  })

  await t.test('the tail past the fourth title is summed up instead of listed', () => {
    const queue = [track('a'), track('b'), track('c'), track('d'), track('e'), track('f', true)]
    const message = buildQueueMessage({ queue }, 'en')

    assert.equal(message, 'Queue [5]: 1. Track a | 2. Track b | 3. Track c | 4. Track d [+1]')
  })
})

test('buildRedemptionAcceptedMessage', async (t) => {
  await t.test('names the track and its place in the queue', () => {
    const message = buildRedemptionAcceptedMessage('alice', { song: { title: 'Never Gonna Give You Up' }, started: false, position: 3 })
    assert.equal(message, '@alice, “Never Gonna Give You Up” added to the queue [#3]')
  })

  await t.test('a track that starts right away says it is playing now', () => {
    const message = buildRedemptionAcceptedMessage('alice', { song: { title: 'Song' }, started: true, position: 0 })
    assert.equal(message, '@alice, “Song” added, playing now')
  })

  await t.test('a long title is shortened', () => {
    const message = buildRedemptionAcceptedMessage('alice', { song: { title: 'A'.repeat(100) }, started: false, position: 1 })
    assert.ok(message.includes(`“${'A'.repeat(39)}…”`))
  })
})

test('buildRedemptionRejectionMessage', async (t) => {
  // the reason is a plain { code, params } — a thrown AppError fits the same shape when one reaches this far
  await t.test('a request that was never queued gets only the reason', () => {
    assert.equal(buildRedemptionRejectionMessage('alice', { code: 'DUPLICATE' }), '@alice, that track is already in the queue, points refunded')
  })

  await t.test('a playback failure names the track and the reason', () => {
    const message = buildRedemptionRejectionMessage('alice', { code: 'PLAYBACK_VIDEO_UNAVAILABLE', params: { title: 'Song' } })
    assert.equal(message, '@alice, “Song” could not be played: the video became unavailable, points refunded')
  })

  await t.test('every playback failure reason names the track', () => {
    for (const code of ['PLAYBACK_VIDEO_UNAVAILABLE', 'PLAYBACK_EMBED_DISALLOWED', 'PLAYBACK_FAILED'] as const) {
      const message = buildRedemptionRejectionMessage('alice', { code, params: { title: 'Song' } })
      assert.ok(message.includes('“Song”') && !message.includes('{{'), code)
    }
  })

  await t.test('a long title in a playback failure is shortened', () => {
    const message = buildRedemptionRejectionMessage('alice', { code: 'PLAYBACK_FAILED', params: { title: 'A'.repeat(100) } })
    assert.ok(message.includes(`“${'A'.repeat(39)}…”`))
  })
})
