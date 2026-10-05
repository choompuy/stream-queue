import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const { shutdown } = await import('../../src/shutdown.js')

test('shutdown()', async (t) => {
  await t.test('saves, then exits with the given code, once even when called again (Ctrl+C pressed twice)', async () => {
    const codes: number[] = []

    await shutdown(3, (code) => void codes.push(code))
    await shutdown(0, (code) => void codes.push(code))

    assert.deepEqual(codes, [3])
  })
})
