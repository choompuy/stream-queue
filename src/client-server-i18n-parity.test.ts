import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { t as serverT, translateErrorCode as serverTranslateErrorCode } from './i18n.js'

// The browser (public/js/i18n.js + shared.js) and the server (src/i18n.ts) each carry their own copy of
// the same translation logic. These tests keep the two copies from drifting apart.

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url))
const LOCALES = ['en', 'ru']

const readLocale = (locale: string) => JSON.parse(readFileSync(join(PUBLIC_DIR, 'locales', `${locale}.json`), 'utf8'))

;(globalThis as any).fetch = async (url: string) => {
  const locale = /\/locales\/(\w+)\.json/.exec(url)![1]
  return { json: async () => readLocale(locale) }
}

const client = (await import(pathToFileURL(join(PUBLIC_DIR, 'js', 'i18n.js')).href)) as {
  t: (key: string, params?: Record<string, unknown>) => string
  loadTranslations: (locale: string) => Promise<boolean>
}
const shared = (await import(pathToFileURL(join(PUBLIC_DIR, 'js', 'shared.js')).href)) as {
  translateErrorCode: (t: unknown, code: string, params?: Record<string, unknown>, fallback?: string) => string
}

function leaves(node: unknown, prefix = ''): Array<[string, string]> {
  if (typeof node === 'string') return [[prefix, node]]
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([key, value]) => leaves(value, prefix ? `${prefix}.${key}` : key))
  }
  return []
}

// every {{placeholder}} of a string, filled with a value full of special replacement patterns
function nastyParams(template: string): Record<string, string> {
  const params: Record<string, string> = {}
  for (const match of template.matchAll(/{{(\w+)}}/g)) params[match[1]] = "$& $$ $1 $` $' end"
  return params
}

for (const locale of LOCALES) {
  test(`client and server translate every "${locale}" string identically`, async () => {
    await client.loadTranslations(locale)

    let compared = 0
    for (const [key, template] of leaves(readLocale(locale))) {
      const params = nastyParams(template)
      assert.equal(client.t(key, params), serverT(locale, key, params), `mismatch for "${key}"`)
      compared++
    }

    assert.ok(compared > 50, 'expected to compare the whole locale')
  })

  test(`client and server resolve every API error code identically ("${locale}")`, async () => {
    await client.loadTranslations(locale)

    const codes = new Set<string>()
    for (const [key] of leaves(readLocale(locale).api?.errors ?? {})) {
      codes.add(key.replace(/([A-Z])/g, '_$1').toUpperCase())
    }

    for (const code of codes) {
      const params = { count: 3, title: '$& $$' }
      const fromServer = serverTranslateErrorCode(locale, code, params)
      const fromClient = shared.translateErrorCode(client.t, code, params, '<<fallback>>')

      if (fromServer === null) continue // code that does not round-trip through the naming scheme
      assert.equal(fromClient, fromServer, `mismatch for error code ${code}`)
    }
  })
}

test('client falls back to the provided message for an unknown error code', async () => {
  await client.loadTranslations('en')
  assert.equal(shared.translateErrorCode(client.t, 'NOT_A_REAL_CODE', {}, 'server message'), 'server message')
  assert.equal(serverTranslateErrorCode('en', 'NOT_A_REAL_CODE'), null)
})
