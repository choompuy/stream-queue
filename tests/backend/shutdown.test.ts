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

test('shutdown(): the safety net', async (t) => {
  await t.test('is cancelled once saving finished, so the exit does not happen a second time 5 seconds later', async (context) => {
    // a new copy of the module: the first test above used up the "already shutting down" flag of the first one
    const { shutdown: fresh } = await import(`../../src/shutdown.js?safety-net=${Date.now()}`)
    context.mock.timers.enable({ apis: ['setTimeout'] })
    const codes: number[] = []

    await fresh(0, (code: number) => void codes.push(code))
    context.mock.timers.tick(10_000)

    assert.deepEqual(codes, [0])
  })

  await t.test('does fire when saving has not finished within 5 seconds', async (context) => {
    const { shutdown: fresh } = await import(`../../src/shutdown.js?safety-net=hung-${Date.now()}`)
    context.mock.timers.enable({ apis: ['setTimeout'] })
    const codes: number[] = []

    const done = fresh(7, (code: number) => void codes.push(code))
    context.mock.timers.tick(5000) // the call has only just started: saving cannot have finished yet

    assert.deepEqual(codes, [7], 'the safety net ended the process')
    await done
  })
})
