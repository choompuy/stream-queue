import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const { playbackFailureReasonCode } = await import('./player.js')

test('playbackFailureReasonCode', async (t) => {
  await t.test('100 -> video unavailable', () => {
    assert.equal(playbackFailureReasonCode(100), 'PLAYBACK_VIDEO_UNAVAILABLE')
  })

  await t.test('101 and 150 -> embed disallowed', () => {
    assert.equal(playbackFailureReasonCode(101), 'PLAYBACK_EMBED_DISALLOWED')
    assert.equal(playbackFailureReasonCode(150), 'PLAYBACK_EMBED_DISALLOWED')
  })

  await t.test('other/unknown codes -> generic failed', () => {
    assert.equal(playbackFailureReasonCode(2), 'PLAYBACK_FAILED')
    assert.equal(playbackFailureReasonCode(undefined), 'PLAYBACK_FAILED')
  })
})
