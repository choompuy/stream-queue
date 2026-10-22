import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The real locales, read from an isolated copy: the notice texts come from them, and the settings decide
// which language that is
const dir = mkdtempSync(join(tmpdir(), 'streamqueue-test-'))
process.chdir(dir)
const publicDir = fileURLToPath(new URL('../../public/', import.meta.url))
mkdirSync(join(dir, 'public'), { recursive: true })
cpSync(join(publicDir, 'locales'), join(dir, 'public', 'locales'), { recursive: true })
mkdirSync(join(dir, 'data'), { recursive: true })
writeFileSync(join(dir, 'data', 'settings.json'), JSON.stringify({ locale: 'ru' }))

const { installDesktopNotices, settleDesktopNotices, reportStartupFailure, DESKTOP_NOTICE_DEDUP_MS } = await import('../../src/desktop-notice.js')
const { notify, DESKTOP_NOTICE_CODES } = await import('../../src/state-events.js')
type Notice = import('../../src/state-events.js').Notice
const { NoFreePortError } = await import('../../src/app.js')
const { hasKey, t: translate } = await import('../../src/i18n.js')

type Line = { level: string; code: string; text: string; fatal: boolean }

async function collectWhile(action: () => unknown): Promise<string[]> {
  const lines: string[] = []
  const stop = installDesktopNotices(async (line) => {
    lines.push(line)
  })

  try {
    await action()
    await settleDesktopNotices()
    return lines
  } finally {
    stop()
  }
}

const collect = (notice: Notice): Promise<string[]> => collectWhile(() => notify(notice))
const parse = (line: string): Line => JSON.parse(line.slice('::notice:: '.length)) as Line

test('the protocol line of a desktop notice', async (t) => {
  await t.test('one line: the exact prefix and a JSON document with level, code, text and fatal', async () => {
    const [line] = await collect({ type: 'desktop', level: 'error', code: 'DATA_DIR_NOT_WRITABLE', params: { dir: '/x/y' } })

    assert.ok(line!.startsWith('::notice:: '), 'the line starts with the marker')
    assert.equal(line!.split('\n').length, 1, 'the line is a single line')

    const parsed = parse(line!)
    assert.equal(parsed.level, 'error')
    assert.equal(parsed.code, 'DATA_DIR_NOT_WRITABLE')
    assert.equal(parsed.fatal, false, 'fatal is spelled out, not left out')
    // the settings of the isolated data pick the language, the params fill the template
    assert.equal(parsed.text, translate('ru', 'desktop.dataDirNotWritable', { dir: '/x/y' }))
    assert.ok(parsed.text.includes('/x/y'))
  })

  await t.test('the port change names the new overlay link', async () => {
    const [line] = await collect({ type: 'desktop', level: 'warn', code: 'PORT_CHANGED', params: { from: 4747, to: 4846 } })
    const parsed = parse(line!)

    assert.equal(parsed.level, 'warn')
    assert.ok(parsed.text.includes('http://localhost:4846/overlay'), 'the new overlay URL is part of the text')
    assert.ok(parsed.text.includes('4747'))
  })

  await t.test('a fatal notice says so', async () => {
    const [line] = await collect({ type: 'desktop', level: 'error', code: 'NO_FREE_PORT', fatal: true, params: { from: 1, to: 2 } })

    assert.equal(parse(line!).fatal, true)
  })
})

test('one code reaches the tray at most once per window, a fatal one always', async (t) => {
  const lines: string[] = []
  const stop = installDesktopNotices(async (line) => {
    lines.push(line)
  })
  t.after(() => stop())

  let now = 1_700_000_000_000
  const clock = t.mock.method(Date, 'now', () => now)
  t.after(() => clock.mock.restore())

  notify({ type: 'desktop', level: 'error', code: 'SAVE_FAILED', params: { file: 'a' } })
  await settleDesktopNotices()
  assert.equal(lines.length, 1)

  notify({ type: 'desktop', level: 'error', code: 'SAVE_FAILED', params: { file: 'a' } })
  await settleDesktopNotices()
  assert.equal(lines.length, 1, 'the same code inside the window is not written again')

  notify({ type: 'desktop', level: 'error', code: 'SAVE_FAILED', fatal: true, params: { file: 'a' } })
  await settleDesktopNotices()
  assert.equal(lines.length, 2, 'a fatal notice bypasses the window')

  now += DESKTOP_NOTICE_DEDUP_MS
  notify({ type: 'desktop', level: 'error', code: 'SAVE_FAILED', params: { file: 'a' } })
  await settleDesktopNotices()
  assert.equal(lines.length, 3, 'after the window the code is written again')
})

test('every desktop code has a text in both locales', () => {
  // the key of a code is its camelCase name, the same shape as the API error keys
  const keyOf = (code: string): string => `desktop.${code.toLowerCase().replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())}`

  for (const code of DESKTOP_NOTICE_CODES) {
    assert.ok(hasKey('en', keyOf(code)), `${code} (en)`)
    assert.ok(hasKey('ru', keyOf(code)), `${code} (ru)`)
  }
})

test('reportStartupFailure()', async (t) => {
  await t.test('a refused port range becomes NO_FREE_PORT with its boundaries', async () => {
    const lines = await collectWhile(() => reportStartupFailure(new NoFreePortError(4747, 4846)))

    assert.equal(lines.length, 1)
    const parsed = parse(lines[0]!)
    assert.equal(parsed.code, 'NO_FREE_PORT')
    assert.equal(parsed.level, 'error')
    assert.equal(parsed.fatal, true)
    assert.ok(parsed.text.includes('4747') && parsed.text.includes('4846'), 'the boundaries of the range reach the text')
  })

  await t.test('any other error becomes STARTUP_FAILED with its message', async () => {
    const lines = await collectWhile(() => reportStartupFailure(new Error('boom')))

    assert.equal(lines.length, 1)
    const parsed = parse(lines[0]!)
    assert.equal(parsed.code, 'STARTUP_FAILED')
    assert.equal(parsed.fatal, true)
    assert.ok(parsed.text.includes('boom'))
  })
})
