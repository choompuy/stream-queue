import { test } from 'node:test'
import assert from 'node:assert/strict'
import { t, translateErrorCode } from '../../src/i18n.js'

test('t()', async (test) => {
  await test.test('returns the English string for a known key', () => {
    assert.equal(t('en', 'activity.title'), 'Activity')
  })

  await test.test('falls back to English when the requested locale has no file at all', () => {
    assert.equal(t('xx', 'activity.title'), 'Activity')
  })

  await test.test('returns null for a genuinely unknown key', () => {
    assert.equal(t('en', 'this.key.does.not.exist'), null)
  })

  await test.test('interpolates a plain param', () => {
    assert.equal(t('en', 'toast.nowPlaying', { title: 'Never Gonna Give You Up' }), 'Now playing: Never Gonna Give You Up')
  })

  // Regression test: String.prototype.replace() treats "$1", "$$", "$&", etc.
  // specially when the replacement is a string. A video title containing one
  // of these sequences (e.g. a price in the title) must not get mangled.
  await test.test('a "$" followed by a digit in the value is inserted literally', () => {
    assert.equal(t('en', 'toast.nowPlaying', { title: '$1,000 Challenge' }), 'Now playing: $1,000 Challenge')
  })

  await test.test('a literal "$$" in the value is not collapsed to a single "$"', () => {
    assert.equal(t('en', 'toast.nowPlaying', { title: 'Cash$$Money' }), 'Now playing: Cash$$Money')
  })
})

test('translateErrorCode()', async (test) => {
  await test.test('a known code resolves to its localized message', () => {
    assert.equal(translateErrorCode('en', 'DUPLICATE'), 'This track is already in the queue')
  })

  await test.test('an unknown code returns null', () => {
    assert.equal(translateErrorCode('en', 'NOT_A_REAL_CODE'), null)
  })
})
