import { test } from 'node:test'
import assert from 'node:assert/strict'
import { escapeHtml, formatDuration, youtubeThumbnail, formatViews, getErrorMessage, translateErrorCode } from './shared.js'

test('escapeHtml', async (t) => {
  await t.test('escapes the 5 HTML-significant characters', () => {
    assert.equal(escapeHtml(`<script>alert("x")&'y'</script>`), '&lt;script&gt;alert(&quot;x&quot;)&amp;&#x27;y&#x27;&lt;/script&gt;')
  })

  await t.test('coerces non-strings', () => {
    assert.equal(escapeHtml(123), '123')
    assert.equal(escapeHtml(null), 'null')
  })

  await t.test('leaves plain text untouched', () => {
    assert.equal(escapeHtml('Never Gonna Give You Up'), 'Never Gonna Give You Up')
  })
})

test('formatDuration', async (t) => {
  await t.test('pads seconds under 10', () => {
    assert.equal(formatDuration(65), '1:05')
  })

  await t.test('does not pad minutes', () => {
    assert.equal(formatDuration(605), '10:05')
  })

  await t.test('zero', () => {
    assert.equal(formatDuration(0), '0:00')
  })
})

test('youtubeThumbnail', async (t) => {
  await t.test('builds the default (mqdefault) URL', () => {
    assert.equal(youtubeThumbnail('dQw4w9WgXcQ'), 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg')
  })

  await t.test('accepts a different quality', () => {
    assert.equal(youtubeThumbnail('dQw4w9WgXcQ', 'hqdefault'), 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')
  })

  await t.test('encodes the video id', () => {
    assert.equal(youtubeThumbnail('a/b'), 'https://i.ytimg.com/vi/a%2Fb/mqdefault.jpg')
  })
})

test('formatViews', async (t) => {
  await t.test('millions', () => {
    assert.equal(formatViews(2_500_000), '2.5M')
  })

  await t.test('thousands', () => {
    assert.equal(formatViews(15_400), '15.4K')
  })

  await t.test('below one thousand', () => {
    assert.equal(formatViews(999), '999')
  })
})

test('getErrorMessage', async (t) => {
  await t.test('known code without a translator returns the raw key', () => {
    assert.equal(getErrorMessage(100), 'player.error.videoNotFound')
  })

  await t.test('known code with a translator calls it with the key and code param', () => {
    const calls = []
    const fakeT = (key, params) => {
      calls.push([key, params])
      return `translated:${key}`
    }
    assert.equal(getErrorMessage(101, fakeT), 'translated:player.error.embedNotAllowed')
    assert.deepEqual(calls, [['player.error.embedNotAllowed', { code: 101 }]])
  })

  await t.test('unknown code without a translator falls back to a generic string', () => {
    assert.equal(getErrorMessage(9999), 'Error code 9999')
  })

  await t.test('unknown code with a translator uses the generic key', () => {
    const fakeT = (key) => key
    assert.equal(getErrorMessage(9999, fakeT), 'player.error.errorCode')
  })
})

test('translateErrorCode', async (t) => {
  await t.test('no code returns the fallback', () => {
    assert.equal(translateErrorCode(() => 'x', null, undefined, 'fallback text'), 'fallback text')
  })

  await t.test('converts SCREAMING_SNAKE_CASE codes to a camelCase api.errors key', () => {
    const seen = []
    const fakeT = (key) => {
      seen.push(key)
      return 'translated'
    }
    translateErrorCode(fakeT, 'INVALID_YOUTUBE_URL')
    assert.deepEqual(seen, ['api.errors.invalidYoutubeUrl'])
  })

  await t.test('falls back when the translator just echoes the key back (missing translation)', () => {
    const fakeT = (key) => key
    assert.equal(translateErrorCode(fakeT, 'SOME_CODE', undefined, 'fallback text'), 'fallback text')
  })

  await t.test('returns the translation when one is actually found', () => {
    const fakeT = (key) => (key === 'api.errors.duplicate' ? 'This track is already in the queue' : key)
    assert.equal(translateErrorCode(fakeT, 'DUPLICATE', undefined, 'fallback text'), 'This track is already in the queue')
  })
})
