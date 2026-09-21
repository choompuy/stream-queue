import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const { runStartupTasks } = await import('./startup.js')
const { updateConfig } = await import('./config.js')
const queue = await import('./queue.js')
const player = await import('./player.js')

const song = { videoId: 'aaaaaaaaaaa', title: 'A', channelTitle: 'C', thumbnail: '', duration: 100, views: 1, url: 'u' }

test('runStartupTasks()', async (t) => {
  await t.test('a fallback playlist that cannot be loaded (no API key) does not reject, and playback still starts', async (t) => {
    const warn = t.mock.method(console, 'warn', () => {})
    updateConfig({ fallbackPlaylist: { playlistId: 'PLstartup000001' } })
    queue.addSong(song, 'viewer', true, true)
    assert.equal(player.getState().current, null)

    await assert.doesNotReject(runStartupTasks())

    assert.equal(player.getState().current?.videoId, 'aaaaaaaaaaa')
    assert.equal(warn.mock.callCount(), 1)
  })

  await t.test('does not touch a track that is already playing', async (t) => {
    t.mock.method(console, 'warn', () => {})
    queue.addSong({ ...song, videoId: 'bbbbbbbbbbb' }, 'viewer', true, true)

    await runStartupTasks()

    assert.equal(player.getState().current?.videoId, 'aaaaaaaaaaa')
  })
})
