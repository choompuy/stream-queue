import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const jsdom = new JSDOM('<!doctype html><html><body><div id="toastContainer"></div></body></html>')

globalThis.window = jsdom.window
globalThis.document = jsdom.window.document

globalThis.fetch = async (url) => ({ ok: true, json: async () => JSON.parse(readFileSync(new URL(`../../../public${url}`, import.meta.url), 'utf8')) })

const { initI18n } = await import('../../../public/js/i18n.js')
const { toastError, toastSuccess } = await import('../../../public/js/control/toast.js')

const container = document.getElementById('toastContainer')
const shown = () => [...container.querySelectorAll('.toast-wrapper:not(.toast-leaving) .toast-message')].map((node) => node.textContent)

test('toasts', async (t) => {
  await initI18n('ru')

  await t.test('the close button is named in the language of the panel', () => {
    toastSuccess('done', { duration: 0 })

    assert.equal(container.querySelector('.toast-close').getAttribute('aria-label'), 'Закрыть')
  })

  await t.test('the same error is not shown twice while it is still on screen', () => {
    toastError('boom', { duration: 0 })
    toastError('boom', { duration: 0 })

    assert.equal(shown().filter((text) => text === 'boom').length, 1)
  })

  await t.test('no more than three are shown, the oldest one makes room', () => {
    toastSuccess('one', { duration: 0 })
    toastSuccess('two', { duration: 0 })
    toastSuccess('three', { duration: 0 })

    assert.equal(shown().length <= 3, true)
    assert.equal(shown().at(-1), 'three')
  })
})
