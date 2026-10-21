import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const locale = (name) => JSON.parse(readFileSync(new URL(`../../public/locales/${name}.json`, import.meta.url), 'utf8'))

const keysOf = (object, prefix = '') =>
  Object.entries(object).flatMap(([key, value]) => (typeof value === 'object' ? keysOf(value, `${prefix}${key}.`) : [`${prefix}${key}`]))

test('both languages have the same keys', () => {
  const en = keysOf(locale('en'))
  const ru = keysOf(locale('ru'))

  assert.deepEqual(en.filter((key) => !ru.includes(key)), [], 'missing in ru')
  assert.deepEqual(ru.filter((key) => !en.includes(key)), [], 'missing in en')
})
