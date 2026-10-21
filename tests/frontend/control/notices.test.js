import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setupPanel } from './panel-env.js'

const panel = setupPanel()

const { initI18n } = await import('../../../public/js/i18n.js')
await initI18n('en')
const { showNotice } = await import('../../../public/js/control/notices.js')

test('showNotice()', async (t) => {
  await t.test('shows a request of a viewer as it was told: who and what', () => {
    showNotice({ type: 'viewerRequest', user: 'amy', title: 'Song' })

    assert.ok(panel.toasts().includes('\u{1F3B5} amy added: Song'))
  })

  await t.test('leaves alone a kind of notice it does not know, so a newer server can tell more than an older panel shows', () => {
    const before = panel.toasts().join('|')

    assert.doesNotThrow(() => showNotice({ type: 'somethingNew', what: 'x' }))
    assert.doesNotThrow(() => showNotice(null))
    assert.doesNotThrow(() => showNotice(undefined))

    assert.equal(panel.toasts().join('|'), before)
  })

  await t.test('shows an error notice with the translation of its code, filled with its params', () => {
    showNotice({ type: 'error', level: 'error', code: 'TWITCH_API_ERROR', params: { message: 'The custom reward title must be unique' } })

    assert.ok(panel.toasts().some((toast) => toast.includes('Twitch API error: The custom reward title must be unique')))
  })

  await t.test('an error notice with a code it has no translation for falls back to the generic message', () => {
    showNotice({ type: 'error', level: 'error', code: 'NOT_A_REAL_CODE' })

    assert.ok(panel.toasts().some((toast) => toast.includes('Something went wrong')))
  })
})
