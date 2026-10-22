import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// An empty working directory: no public/locales, so no key resolves and the fallback chain shows itself
const dir = mkdtempSync(join(tmpdir(), 'streamqueue-test-'))
process.chdir(dir)

const { installDesktopNotices, settleDesktopNotices, writeDesktopReadyLine } = await import('../../src/desktop-notice.js')
const { notify } = await import('../../src/state-events.js')
const { ensureDataDirectory } = await import('../../src/persist.js')

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

const parse = (line: string): Line => JSON.parse(line.slice('::notice:: '.length)) as Line

test('without the locales the text falls back', async (t) => {
  await t.test('the message of the notice is the text', async () => {
    const [line] = await collectWhile(() => notify({ type: 'desktop', level: 'warn', code: 'PORT_CHANGED', message: 'the port moved' }))

    assert.equal(parse(line!).text, 'the port moved')
  })

  await t.test('without a message the code itself is the text', async () => {
    const [line] = await collectWhile(() => notify({ type: 'desktop', level: 'warn', code: 'PORT_CHANGED' }))

    assert.equal(parse(line!).text, 'PORT_CHANGED')
  })

  await t.test('a text with a line break still is one line', async () => {
    const [line] = await collectWhile(() => notify({ type: 'desktop', level: 'error', code: 'UNEXPECTED_ERROR', message: 'line one\nline two' }))

    assert.equal(line!.split('\n').length, 1, 'the protocol line stays single-line')
    assert.equal(parse(line!).text, 'line one\nline two', 'the break survived inside the JSON string')
  })
})

test('a data directory that cannot be created is reported', async () => {
  // a file where the directory belongs: every way of creating the directory fails on it
  writeFileSync(join(dir, 'data'), 'not a directory')

  const lines = await collectWhile(() => ensureDataDirectory())

  assert.equal(lines.length, 1)
  assert.equal(parse(lines[0]!).code, 'DATA_DIR_NOT_WRITABLE')
  assert.equal(parse(lines[0]!).level, 'error')
})

test('the ready line names the port', async (t) => {
  const written: string[] = []
  const stdout = t.mock.method(
    process.stdout,
    'write',
    ((chunk: string, _encoding: string, callback?: (error?: Error | null) => void) => {
      written.push(chunk)
      callback?.()
      return true
    }) as typeof process.stdout.write
  )
  t.after(() => stdout.mock.restore())

  await writeDesktopReadyLine(4747)

  assert.equal(written[0], '::ready:: {"port":4747}\n')
})
