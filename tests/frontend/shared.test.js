import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { escapeHtml, formatDuration, formatTrackDuration, youtubeThumbnail, formatViews, translateErrorCode, setFieldState, describeTrack } from '../../public/js/shared.js'

// describeTrack names a track the way the page does, with the page's own words for what is missing: the translations
// have to be in for that
const dom = new JSDOM('<!doctype html><html><body></body></html>')
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.fetch = async () => ({ ok: true, json: async () => JSON.parse(readFileSync(fileURLToPath(new URL('../../public/locales/en.json', import.meta.url)), 'utf8')) })

const { initI18n } = await import('../../public/js/i18n.js')
await initI18n('en')

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

  await t.test('zero, and what is no length at all, is 0:00', () => {
    assert.equal(formatDuration(0), '0:00')
    assert.equal(formatDuration(-5), '0:00')
    assert.equal(formatDuration(undefined), '0:00')
    assert.equal(formatDuration(NaN), '0:00')
  })

  await t.test('shows hours from an hour on, with minutes padded', () => {
    assert.equal(formatDuration(3600), '1:00:00')
    assert.equal(formatDuration(3725), '1:02:05')
    assert.equal(formatDuration(7325), '2:02:05')
  })
})

test('formatTrackDuration', async (t) => {
  await t.test('a track with a length shows it', () => {
    assert.equal(formatTrackDuration(65), '1:05')
  })

  await t.test('a track without one is a live stream, with the translated label', () => {
    assert.equal(formatTrackDuration(0), 'LIVE')
    assert.equal(formatTrackDuration(null), 'LIVE')
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

  await t.test('round numbers have no ".0"', () => {
    assert.equal(formatViews(1000), '1K')
    assert.equal(formatViews(3_000_000), '3M')
  })

  await t.test('no count at all is zero', () => {
    assert.equal(formatViews(null), '0')
    assert.equal(formatViews(undefined), '0')
  })

  await t.test('follows the language of the panel: the units and the decimal mark', () => {
    const russian = (views) => formatViews(views, 'ru').replace(/\s/g, ' ')

    assert.equal(russian(2_500_000), '2,5 млн')
    assert.equal(russian(15_400), '15,4 тыс.')
    assert.equal(russian(999), '999')
  })
})

test('translateErrorCode', async (t) => {
  await t.test('no code returns the fallback', () => {
    assert.equal(
      translateErrorCode(() => 'x', null, undefined, 'fallback text'),
      'fallback text'
    )
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

// a minimal element: only what setClass / setFieldState touch
function fakeElement() {
  const classes = new Set()
  return { classes, classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) } }
}

test('setFieldState', async (t) => {
  await t.test('shows only one state at a time and clears it with null', () => {
    const input = fakeElement()
    setFieldState(input, 'changed')
    setFieldState(input, 'saved')
    assert.deepEqual([...input.classes], ['saved'])
    setFieldState(input, 'error')
    assert.deepEqual([...input.classes], ['error'])
    setFieldState(input, null)
    assert.equal(input.classes.size, 0)
  })
})

test('describeTrack', async (t) => {
  await t.test('names a track the way the page does: what is missing gets the page\'s own words for it', () => {
    assert.deepEqual(describeTrack(null), {
      title: 'Unknown title',
      channel: 'Unknown channel',
      duration: 'LIVE',
      requester: ''
    })
  })

  await t.test('says everything a full track brings with it', () => {
    assert.deepEqual(describeTrack({ title: 'Song', channelTitle: 'Chan', duration: 90, requestedBy: 'amy' }), {
      title: 'Song',
      channel: 'Chan',
      duration: '1:30',
      requester: '@amy'
    })
  })

  await t.test('a playlist track is named by its localized name', () => {
    assert.equal(describeTrack({ title: 'X', isFallback: true }).requester, 'Playlist')
  })
})
