import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'streamqueue-test-'))
process.chdir(dir)

const stateFile = join(dir, 'cache', 'queue-state.json')
mkdirSync(join(dir, 'cache'), { recursive: true })
const original = JSON.stringify({
  current: { videoId: 'aaaaaaaaaaa', title: 'A', channelTitle: '', thumbnail: '', duration: 1, views: 1, url: 'u', requestedBy: 'viewer' },
  queue: []
})
writeFileSync(stateFile, original)

test('importing the player modules has no side effects', async () => {
  const player = await import('../../src/player.js')
  const queue = await import('../../src/queue.js')
  const { notifyStateChange } = await import('../../src/state-events.js')
  const { flushAllStores } = await import('../../src/persist.js')

  assert.equal(player.getState().current, null, 'the saved state must not be loaded until initState() is called')

  queue.setCurrent(null)
  notifyStateChange()
  await flushAllStores()

  assert.equal(readFileSync(stateFile, 'utf8'), original, 'the state file must not be written until initState() is called')
})
