import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isValidVideoId, parseYouTubeUrl, parsePlaylistId } from '../../../src/youtube/url.js'

test('isValidVideoId', async (t) => {
  await t.test('accepts an 11-char id', () => {
    assert.equal(isValidVideoId('dQw4w9WgXcQ'), true)
  })

  await t.test('rejects wrong length', () => {
    assert.equal(isValidVideoId('short'), false)
  })

  await t.test('rejects null/undefined', () => {
    assert.equal(isValidVideoId(null), false)
    assert.equal(isValidVideoId(undefined), false)
  })
})

test('parseYouTubeUrl', async (t) => {
  await t.test('watch URL', () => {
    assert.deepEqual(parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), {
      isYouTube: true,
      videoId: 'dQw4w9WgXcQ'
    })
  })

  await t.test('youtu.be short link', () => {
    assert.deepEqual(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ'), {
      isYouTube: true,
      videoId: 'dQw4w9WgXcQ'
    })
  })

  await t.test('shorts URL', () => {
    assert.deepEqual(parseYouTubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ'), {
      isYouTube: true,
      videoId: 'dQw4w9WgXcQ'
    })
  })

  await t.test('embed URL', () => {
    assert.deepEqual(parseYouTubeUrl('https://www.youtube.com/embed/dQw4w9WgXcQ'), {
      isYouTube: true,
      videoId: 'dQw4w9WgXcQ'
    })
  })

  await t.test('m. and www. prefixes are stripped before matching the host', () => {
    assert.equal(parseYouTubeUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ').videoId, 'dQw4w9WgXcQ')
  })

  await t.test('a youtube.com URL with no resolvable video id is still flagged as youtube', () => {
    assert.deepEqual(parseYouTubeUrl('https://www.youtube.com/results?search_query=test'), {
      isYouTube: true,
      videoId: null
    })
  })

  await t.test('non-YouTube URL', () => {
    assert.deepEqual(parseYouTubeUrl('https://example.com/watch?v=dQw4w9WgXcQ'), {
      isYouTube: false,
      videoId: null
    })
  })

  await t.test('plain text query is not treated as a URL at all', () => {
    assert.deepEqual(parseYouTubeUrl('never gonna give you up'), {
      isYouTube: false,
      videoId: null
    })
  })
})

test('parsePlaylistId', async (t) => {
  await t.test('bare playlist id', () => {
    assert.equal(parsePlaylistId('PLbpi6ZahtOH6Blw3RGYpWkSByi_T7Rygb'), 'PLbpi6ZahtOH6Blw3RGYpWkSByi_T7Rygb')
  })

  await t.test('playlist URL with a list param', () => {
    assert.equal(parsePlaylistId('https://www.youtube.com/playlist?list=PLbpi6ZahtOH6Blw3RGYpWkSByi_T7Rygb'), 'PLbpi6ZahtOH6Blw3RGYpWkSByi_T7Rygb')
  })

  await t.test('watch URL with a list param attached', () => {
    assert.equal(
      parsePlaylistId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLbpi6ZahtOH6Blw3RGYpWkSByi_T7Rygb'),
      'PLbpi6ZahtOH6Blw3RGYpWkSByi_T7Rygb'
    )
  })

  await t.test('rejects a video id passed where a playlist id was expected', () => {
    assert.equal(parsePlaylistId('dQw4w9WgXcQ'), null)
  })

  await t.test('empty string', () => {
    assert.equal(parsePlaylistId(''), null)
  })

  await t.test('URL without a list param', () => {
    assert.equal(parsePlaylistId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), null)
  })
})
