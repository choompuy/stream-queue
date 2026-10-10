import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const read = (path) => readFileSync(new URL(`../../public/${path}`, import.meta.url), 'utf8')
const locale = (name) => JSON.parse(read(`locales/${name}.json`))
const get = (object, key) => key.split('.').reduce((value, part) => value?.[part], object)
const normalize = (text) => text.replace(/\s+/g, ' ').trim()
const keysOf = (object, prefix = '') =>
  Object.entries(object).flatMap(([key, value]) => (typeof value === 'object' ? keysOf(value, `${prefix}${key}.`) : [`${prefix}${key}`]))

const en = locale('en')
const ru = locale('ru')
const pages = { 'index.html': new JSDOM(read('index.html')).window.document, 'overlay.html': new JSDOM(read('overlay.html')).window.document }

// [element, key, attribute]: attribute is null for the text of the element
const translated = (document) =>
  [...document.querySelectorAll('*')].flatMap((element) =>
    [...element.attributes]
      .filter((attribute) => attribute.name.startsWith('data-i18n'))
      .map((attribute) => [element, attribute.value, attribute.name === 'data-i18n' ? null : attribute.name.slice('data-i18n-'.length)])
  )

for (const [name, document] of Object.entries(pages)) {
  test(name, async (t) => {
    await t.test('has no id twice', () => {
      const ids = [...document.querySelectorAll('[id]')].map((element) => element.id)

      assert.deepEqual([...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))], [])
    })

    await t.test('has a type on every button, so none of them submits anything', () => {
      assert.deepEqual([...document.querySelectorAll('button:not([type])')].map((button) => button.id || button.textContent.trim()), [])
    })

    await t.test('names every field: a label around it, a label for it, or an aria-label', () => {
      const unnamed = [...document.querySelectorAll('input:not([type=hidden]), select, textarea')].filter(
        (field) => !field.closest('label') && !field.getAttribute('aria-label') && !(field.id && document.querySelector(`label[for="${field.id}"]`))
      )

      assert.deepEqual(
        unnamed.map((field) => field.id),
        []
      )
    })

    await t.test('uses only keys that both languages have', () => {
      const missing = translated(document)
        .map(([, key]) => key)
        .filter((key) => typeof get(en, key) !== 'string' || typeof get(ru, key) !== 'string')

      assert.deepEqual(missing, [])
    })

    await t.test('shows, before the translation arrives, the English text that the translation has', () => {
      const stale = translated(document)
        .map(([element, key, attribute]) => ({ key, attribute, shown: attribute ? element.getAttribute(attribute) : element.textContent }))
        .filter(({ shown }) => shown !== null)
        .filter(({ key, shown }) => normalize(shown) !== normalize(get(en, key)))

      assert.deepEqual(
        stale.map(({ key, shown }) => `${key}: ${normalize(shown)}`),
        []
      )
    })
  })
}

test('the scripts find the elements they look for', async (t) => {
  const idsIn = (source) => [...source.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)].map((match) => match[1])

  await t.test('the control panel (dom.js) in index.html', () => {
    const missing = idsIn(read('js/control/dom.js')).filter((id) => !pages['index.html'].getElementById(id))

    assert.deepEqual(missing, [])
  })

  await t.test('the overlay in overlay.html', () => {
    const missing = idsIn(read('js/overlay.js')).filter((id) => !pages['overlay.html'].getElementById(id))

    assert.deepEqual(missing, [])
  })
})

test('the languages', async (t) => {
  await t.test('have the same keys', () => {
    const inEnglish = keysOf(en)
    const inRussian = keysOf(ru)

    assert.deepEqual(
      inEnglish.filter((key) => !inRussian.includes(key)),
      []
    )
    assert.deepEqual(
      inRussian.filter((key) => !inEnglish.includes(key)),
      []
    )
  })
})

test('the toasts', async (t) => {
  await t.test('are announced by screen readers', () => {
    const container = pages['index.html'].getElementById('toastContainer')

    assert.equal(container.getAttribute('aria-live'), 'polite')
  })
})
