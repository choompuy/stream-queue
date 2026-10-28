import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getTwitchClientId } from '../../src/env.js'

test('getTwitchClientId()', async (t) => {
  await t.test('returns an empty string, not a throw, when TWITCH_CLIENT_ID is unset', () => {
    delete process.env.TWITCH_CLIENT_ID
    assert.equal(getTwitchClientId(), '')
  })

  await t.test('trims surrounding whitespace', () => {
    process.env.TWITCH_CLIENT_ID = '  abc123  '
    assert.equal(getTwitchClientId(), 'abc123')
  })

  await t.test('a whitespace-only value is treated as unset', () => {
    process.env.TWITCH_CLIENT_ID = '   '
    assert.equal(getTwitchClientId(), '')
  })
})

// The values of `.env` in the app root: in dev (and here) that is the working directory
test('loadEnvFile()', async (t) => {
  const { mkdtempSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { loadEnvFile } = await import('../../src/runtime.js')

  const original = process.cwd()
  const dir = mkdtempSync(join(tmpdir(), 'streamqueue-test-'))
  process.chdir(dir)
  t.after(() => {
    process.chdir(original)
    delete process.env.TWITCH_CLIENT_ID
    delete process.env.STREAMQUEUE_TEST_OTHER
  })

  const load = (content: string): void => {
    delete process.env.TWITCH_CLIENT_ID
    delete process.env.STREAMQUEUE_TEST_OTHER
    writeFileSync(join(dir, '.env'), content)
    loadEnvFile()
  }

  await t.test('reads the values from .env in the app root', () => {
    load('TWITCH_CLIENT_ID=abc123\nSTREAMQUEUE_TEST_OTHER=x\n')
    assert.equal(process.env.TWITCH_CLIENT_ID, 'abc123')
    assert.equal(process.env.STREAMQUEUE_TEST_OTHER, 'x')
  })

  await t.test('a file from a Windows editor works: CRLF line ends and a BOM in front', () => {
    load('\uFEFFTWITCH_CLIENT_ID=abc123\r\nSTREAMQUEUE_TEST_OTHER=x\r\n')
    assert.equal(process.env.TWITCH_CLIENT_ID, 'abc123', 'the BOM must not stick to the first name')
    assert.equal(process.env.STREAMQUEUE_TEST_OTHER, 'x')
  })

  await t.test('quotes, comments, export and a non-Latin value', () => {
    load('# a comment\nexport TWITCH_CLIENT_ID="abc 123" # inline\nSTREAMQUEUE_TEST_OTHER=твой_id\n')
    assert.equal(process.env.TWITCH_CLIENT_ID, 'abc 123')
    assert.equal(process.env.STREAMQUEUE_TEST_OTHER, 'твой_id')
  })

  await t.test('what the environment already holds is not overwritten', () => {
    delete process.env.STREAMQUEUE_TEST_OTHER
    process.env.TWITCH_CLIENT_ID = 'from-environment'
    writeFileSync(join(dir, '.env'), 'TWITCH_CLIENT_ID=from-file\nSTREAMQUEUE_TEST_OTHER=from-file\n')
    loadEnvFile()
    assert.equal(process.env.TWITCH_CLIENT_ID, 'from-environment')
    assert.equal(process.env.STREAMQUEUE_TEST_OTHER, 'from-file')
  })

  await t.test('no .env at all is not an error', async () => {
    const { rmSync } = await import('node:fs')
    rmSync(join(dir, '.env'), { force: true })
    delete process.env.TWITCH_CLIENT_ID
    assert.doesNotThrow(() => loadEnvFile())
    assert.equal(process.env.TWITCH_CLIENT_ID, undefined)
  })

  await t.test('a line that is not a pair is skipped, the rest is read', () => {
    load('this is not a pair\nTWITCH_CLIENT_ID=abc123\n')
    assert.equal(process.env.TWITCH_CLIENT_ID, 'abc123')
  })
})
