import { test } from 'node:test'
import assert from 'node:assert/strict'
import { translateErrorCode } from './i18n.js'

test('API error codes map to their own message', async (t) => {
  await t.test('INVALID_REQUEST no longer pretends to be "username required"', () => {
    assert.equal(translateErrorCode('en', 'INVALID_REQUEST'), null)
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
