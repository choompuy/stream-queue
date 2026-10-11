import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const { runStartupTasks } = await import('../../src/startup.js')
const { updateConfig } = await import('../../src/config.js')
const queue = await import('../../src/queue.js')
const player = await import('../../src/player.js')

const song = { videoId: 'aaaaaaaaaaa', title: 'A', channelTitle: 'C', thumbnail: '', duration: 100, views: 1, url: 'u' }

test('runStartupTasks()', async (t) => {
  await t.test('a fallback playlist that cannot be loaded (no API key) does not reject, and playback still starts', async (t) => {
    const warn = t.mock.method(console, 'warn', () => {})
    updateConfig({ fallbackPlaylist: { playlistId: 'PLstartup000001' } })
    // Don't add anything - start with empty player
    assert.equal(player.getState().current, null)

    await assert.doesNotReject(runStartupTasks())

    // With no queue and no fallback playlist, current stays null
    assert.equal(player.getState().current, null)
    assert.equal(warn.mock.callCount(), 1)
  })

  await t.test('does not touch a track that is already playing', async (t) => {
    t.mock.method(console, 'warn', () => {})
    // Set a track as current before calling runStartupTasks
    queue.setCurrent({ ...song, videoId: 'aaaaaaaaaaa', requestedBy: 'viewer' })

    await runStartupTasks()

    assert.equal(player.getState().current?.videoId, 'aaaaaaaaaaa')
  })
})
