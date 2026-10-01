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

const { buildRedemptionAcceptedMessage, buildRedemptionRejectionMessage } = await import('../../src/chat-replies.js')

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
