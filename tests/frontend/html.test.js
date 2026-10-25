import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
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

    await t.test('names every field: an aria-label, a label for it, or a label that has no other field in it', () => {
      const fieldsOf = (label) => label.querySelectorAll('input:not([type=hidden]), select, textarea')
      // a label that holds several fields (the command, who may use it, on/off) names only the one its `for` points at
      const named = (field) =>
        field.hasAttribute('aria-label') ||
        field.hasAttribute('data-i18n-aria-label') ||
        field.hasAttribute('aria-labelledby') ||
        Boolean(field.id && document.querySelector(`label[for="${field.id}"]`)) ||
        (field.closest('label') !== null && fieldsOf(field.closest('label')).length === 1)

      const unnamed = [...document.querySelectorAll('input:not([type=hidden]), select, textarea')].filter((field) => !named(field))

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

    await t.test('asks its data-confirm questions in words that both languages have', () => {
      const keys = [...document.querySelectorAll('[data-confirm]')].map((element) => element.dataset.confirm)

      assert.deepEqual(
        keys.filter((key) => typeof get(en, key) !== 'string' || typeof get(ru, key) !== 'string'),
        []
      )
    })

    await t.test('lets Enter in a data-submit field press a button that exists and has an action', () => {
      const targets = [...document.querySelectorAll('[data-submit]')].map((element) => document.getElementById(element.dataset.submit))

      assert.deepEqual(
        targets.filter((target) => target?.tagName !== 'BUTTON' || !target.dataset.action),
        []
      )
    })

    await t.test('shows, before the translation arrives, the English text that the translation has', () => {
      const stale = translated(document)
        .map(([element, key, attribute]) => ({ key, attribute, shown: attribute ? element.getAttribute(attribute) : element.textContent }))
        .filter(({ shown }) => shown !== null)
        .filter(({ key, shown }) => normalize(shown) !== normalize(get(en, key)))

      assert.deepEqual(
        stale.map(({ key, shown }) => `${key}\n  html: ${normalize(shown)}\n  en:   ${normalize(get(en, key))}`),
        []
      )
    })
  })
}

test('the scripts find the elements they look for', async (t) => {
  const idsIn = (source) => [...source.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)].map((match) => match[1])

  await t.test('the control panel in index.html: every dom.<id> that the scripts read', () => {
    const controlDir = fileURLToPath(new URL('../../public/js/control', import.meta.url))
    const sources = (dir) =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? sources(join(dir, entry.name)) : entry.name.endsWith('.js') && !['dom.js', 'fields.js'].includes(entry.name) ? [readFileSync(join(dir, entry.name), 'utf8')] : []
      )
    const code = sources(controlDir).join('\n')
    const used = [...code.matchAll(/\bdom\.([A-Za-z0-9_]+)/g)].map((match) => match[1])
    assert.ok(used.length > 100, 'the scan found almost nothing')
    assert.deepEqual([...new Set(used)].filter((id) => id !== 'js' && !pages['index.html'].getElementById(id)), [])
  })

  await t.test('the overlay in overlay.html', () => {
    const missing = idsIn(read('js/overlay.js')).filter((id) => !pages['overlay.html'].getElementById(id))

    assert.deepEqual(missing, [])
  })
})

test('the forms of index.html', async (t) => {
  const document = pages['index.html']

  await t.test('name each value once: an input name is the path of its value in the stored object', () => {
    for (const panel of ['botSettingsPanel', 'twitchChatCommandsPanel', 'twitchRewardForm', 'twitchRewardSection', 'overlaySettingsPanel']) {
      const names = [...document.getElementById(panel).querySelectorAll('[name]')].map((input) => input.name)

      assert.ok(names.length >= 2, `${panel} has only ${names.length} named inputs`)
      assert.deepEqual(names.filter((name, index) => names.indexOf(name) !== index), [], panel)
    }
  })

  await t.test('let a checkbox with data-enables switch an input that is in the same form', () => {
    for (const toggle of document.querySelectorAll('[data-enables]')) {
      const target = document.getElementById(toggle.dataset.enables)

      assert.ok(target?.name, `${toggle.id} switches ${toggle.dataset.enables}, which is not a named input`)
      assert.equal(toggle.closest('[id$="Form"], [id$="Panel"], [id$="Section"]'), target.closest('[id$="Form"], [id$="Panel"], [id$="Section"]'))
    }
  })

  await t.test('keep the API key out of the form: it goes to another endpoint', () => {
    assert.equal(document.getElementById('secYoutubeKey').hasAttribute('name'), false)
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
