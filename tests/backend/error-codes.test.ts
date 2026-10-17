import { test } from 'node:test'
import assert from 'node:assert/strict'
import { translateErrorCode } from '../../src/i18n.js'

test('API error codes map to their own message', async (t) => {
  await t.test('INVALID_REQUEST no longer pretends to be "username required"', () => {
    assert.notEqual(translateErrorCode('en', 'INVALID_REQUEST'), 'Username is required')
    assert.equal(translateErrorCode('en', 'INVALID_REQUEST'), 'Invalid request')
    assert.equal(translateErrorCode('ru', 'INVALID_REQUEST'), 'Некорректный запрос')
  })

  await t.test('a Twitch API error carries the message from Twitch itself', () => {
    assert.equal(translateErrorCode('en', 'TWITCH_API_ERROR', { message: 'The custom reward title must be unique' }), 'Twitch API error: The custom reward title must be unique')
    assert.equal(translateErrorCode('ru', 'TWITCH_API_ERROR', { message: 'boom' }), 'Ошибка Twitch API: boom')
  })

  await t.test('specific codes have their own text in both languages', () => {
    assert.equal(translateErrorCode('en', 'USERNAME_REQUIRED'), 'Username is required')
    assert.equal(translateErrorCode('en', 'INVALID_VIDEO_ID'), 'Invalid video ID')
    assert.equal(translateErrorCode('ru', 'INVALID_VIDEO_ID'), 'Некорректный ID видео')

    for (const code of ['INVALID_JSON', 'PAYLOAD_TOO_LARGE', 'FORBIDDEN_ORIGIN', 'LOCAL_ONLY']) {
      for (const locale of ['en', 'ru']) assert.ok(translateErrorCode(locale, code), `${code} (${locale})`)
    }
  })
})
