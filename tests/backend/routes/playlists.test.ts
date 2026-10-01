import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const express = (await import('express')).default
const { router } = await import('../../../src/routes/playlists.js')
const { getConfig } = await import('../../../src/config.js')
const { upsertPlaylist } = await import('../../../src/playlists.js')

const app = express()
app.use(express.json())
app.use('/api/playlists', router)

const server = app.listen(0)
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/playlists`
after(() => server.close())

const activate = (id: string) => fetch(`${base}/${encodeURIComponent(id)}/activate`, { method: 'POST' })

test('POST /api/playlists/:id/activate', async (t) => {
  await t.test('a malformed id is a 400 and is never stored', async () => {
    const response = await activate('not-a-playlist')

    assert.equal(response.status, 400)
    assert.equal(((await response.json()) as Record<string, any>).code, 'INVALID_PLAYLIST_ID')
    assert.equal(getConfig().fallbackPlaylist.playlistId, null)
  })

  await t.test('a well-formed id that is not a saved playlist is a 404', async () => {
    const response = await activate('PLunknown000001')

    assert.equal(response.status, 404)
    assert.equal(((await response.json()) as Record<string, any>).code, 'PLAYLIST_NOT_FOUND')
    assert.equal(getConfig().fallbackPlaylist.playlistId, null)
  })

  await t.test('when the playlist cannot be loaded the previous config is restored and the error is reported', async () => {
    upsertPlaylist({ id: 'PLsaved00000001', title: 'Saved', thumbnail: '', itemCount: 3 })

    // no YouTube API key in the test data dir, so loading fails with NO_API_KEY
    const response = await activate('PLsaved00000001')

    assert.equal(response.status, 400)
    assert.equal(((await response.json()) as Record<string, any>).code, 'NO_API_KEY')
    assert.equal(getConfig().fallbackPlaylist.playlistId, null)
  })
})
