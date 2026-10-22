import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'streamqueue-test-'))
process.chdir(dir)
mkdirSync(join(dir, 'data'), { recursive: true })

const stateFile = join(dir, 'data', 'queue-state.json')
const original = JSON.stringify({
  current: { videoId: 'aaaaaaaaaaa', title: 'A', channelTitle: '', thumbnail: '', duration: 1, views: 1, url: 'u', requestedBy: 'viewer' },
  queue: []
})
writeFileSync(stateFile, original)

const queue = await import('../../src/queue.js')
const { initState } = await import('../../src/state-file.js')
const { flushAllStores } = await import('../../src/persist.js')

const item = (videoId: string): { videoId: string; title: string; channelTitle: string; thumbnail: string; duration: number; views: number; url: string; requestedBy: string } => ({
  videoId,
  title: videoId[0].toUpperCase(),
  channelTitle: '',
  thumbnail: '',
  duration: 1,
  views: 1,
  url: 'u',
  requestedBy: 'viewer'
})

test('a store update before initState() does not write the state file', async () => {
  queue.setCurrent(item('bbbbbbbbbbb'))
  await flushAllStores()

  assert.equal(readFileSync(stateFile, 'utf8'), original, 'a change before the state was loaded must not reach the file')
})

test('after initState() a store update writes the state file', async () => {
  initState()

  queue.setCurrent(item('ccccccccccc'))
  await flushAllStores()

  const saved = JSON.parse(readFileSync(stateFile, 'utf8'))
  assert.equal(saved.current?.videoId, 'ccccccccccc')
})
