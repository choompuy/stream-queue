import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const jsdom = new JSDOM(
  `<!doctype html><html lang="en"><body>
    <span id="label" data-i18n="greeting">x</span>
    <input id="field" data-i18n-placeholder="greeting" data-i18n-aria-label="onlyEnglish" />
    <button id="button" data-i18n-title="onlyEnglish"></button>
  </body></html>`
)

globalThis.document = jsdom.window.document

// what each /locales/<name>.json answers; a locale that is not listed fails to load
const locales = {
  en: { greeting: 'Hello', onlyEnglish: 'English only', nested: { value: 'Nested' }, price: 'Costs {{amount}}' },
  ru: { greeting: 'Привет' }
}

globalThis.fetch = async (url) => {
  const name = url.replace('/locales/', '').replace('.json', '')
  if (!(name in locales)) throw new Error(`no locale ${name}`)
  return { ok: true, json: async () => locales[name] }
}

const { t, loadTranslations, initI18n, getCurrentLocale } = await import('../../public/js/i18n.js')

test('t()', async (t_) => {
  await loadTranslations('en')

  await t_.test('returns the key itself when nothing is translated', () => {
    assert.equal(t('does.not.exist'), 'does.not.exist')
  })

  await t_.test('resolves nested keys, and a key that points at a group is not a translation', () => {
    assert.equal(t('nested.value'), 'Nested')
    assert.equal(t('nested'), 'nested')
  })

  await t_.test('puts parameters in, and replacement text is taken literally', () => {
    assert.equal(t('price', { amount: 5 }), 'Costs 5')
    assert.equal(t('price', { amount: "$& and $'" }), "Costs $& and $'")
  })
})

test('loading a locale', async (t_) => {
  await t_.test('a key missing from the chosen locale shows the English text, not the key', async () => {
    await loadTranslations('ru')

    assert.equal(getCurrentLocale(), 'ru')
    assert.equal(t('greeting'), 'Привет')
    assert.equal(t('onlyEnglish'), 'English only')
  })

  await t_.test('a locale that cannot be loaded falls back to English', async () => {
    assert.equal(await loadTranslations('xx'), true)
    assert.equal(getCurrentLocale(), 'en')
    assert.equal(t('greeting'), 'Hello')
  })
})

test('initI18n', async (t_) => {
  await t_.test('translates text, placeholder, aria-label and title, and sets the page language', async () => {
    assert.equal(await initI18n('ru'), 'ru')

    assert.equal(document.getElementById('label').textContent, 'Привет')
    assert.equal(document.getElementById('field').placeholder, 'Привет')
    assert.equal(document.getElementById('field').getAttribute('aria-label'), 'English only')
    assert.equal(document.getElementById('button').title, 'English only')
    assert.equal(document.documentElement.lang, 'ru')
  })
})
