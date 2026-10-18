import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const locale = (name) => JSON.parse(read(`../../public/locales/${name}.json`))

const keysOf = (object, prefix = '') =>
  Object.entries(object).flatMap(([key, value]) => (typeof value === 'object' ? keysOf(value, `${prefix}${key}.`) : [`${prefix}${key}`]))

test('both languages have the same keys', () => {
  const en = keysOf(locale('en'))
  const ru = keysOf(locale('ru'))

  assert.deepEqual(en.filter((key) => !ru.includes(key)), [], 'missing in ru')
  assert.deepEqual(ru.filter((key) => !en.includes(key)), [], 'missing in en')
})

// these two are answered with the text the server composes (the detail of what was wrong, what Twitch said), on purpose
const PASS_THROUGH = ['INVALID_REQUEST', 'TWITCH_API_ERROR']

test('every other error code of the API has a message in api.errors, in both languages', () => {
  const types = read('../../src/types.ts')
  const blocks = [...types.matchAll(/export type (?:AppErrorCode|ApiErrorCode)\s*=(.*?)(?=\nexport |\n\n)/gs)]
  const codes = blocks.flatMap(([, body]) => [...body.matchAll(/'([A-Z][A-Z0-9_]+)'/g)].map((match) => match[1])).filter((code) => !PASS_THROUGH.includes(code))
  const camel = (code) => code.toLowerCase().replace(/_([a-z0-9])/g, (_, letter) => letter.toUpperCase())

  assert.ok(codes.length > 10, 'the codes were found in src/types.ts')

  for (const name of ['en', 'ru']) {
    const messages = locale(name).api.errors
    assert.deepEqual(codes.filter((code) => !(camel(code) in messages)), [], `no message in ${name}`)
  }
})
