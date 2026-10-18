import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const express = (await import('express')).default
const { router } = await import('../../../src/routes/playlists.js')
const { getConfig, updateConfig } = await import('../../../src/config.js')
const { upsertPlaylist } = await import('../../../src/playlists.js')
const { errorHandler } = await import('../../../src/error-handler.js')

const app = express()
app.use(express.json())
app.use('/api/playlists', router)
// the routes pass errors on with next(), the real server turns them into API errors in this handler
app.use(errorHandler)

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

const list = async () => ((await (await fetch(base)).json()) as Record<string, any>).data.playlists as Array<{ id: string; isActive: boolean }>

const create = (playlistId: unknown) =>
  fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playlistId })
  })

test('POST /api/playlists', async (t) => {
  await t.test('a malformed playlist id is a 400 INVALID_PLAYLIST_ID from the shared ID-or-URL check', async () => {
    for (const playlistId of ['not a playlist', 'aaaaaaaaaaa']) {
      const response = await create(playlistId)

      assert.equal(response.status, 400, String(playlistId))
      assert.equal(((await response.json()) as Record<string, any>).code, 'INVALID_PLAYLIST_ID', String(playlistId))
    }
  })

  await t.test('a well-formed id or URL is parsed and goes on to load it (no key here, so the load refuses)', async () => {
    const response = await create('https://www.youtube.com/playlist?list=PLsaved00000001')

    assert.equal(response.status, 400)
    assert.equal(((await response.json()) as Record<string, any>).code, 'NO_API_KEY')
  })
})

test('GET /api/playlists', async (t) => {
  await t.test('says for every playlist whether it is the active one', async () => {
    upsertPlaylist({ id: 'PLfirst000000001', title: 'First', thumbnail: '', itemCount: 1 })
    upsertPlaylist({ id: 'PLsecond00000001', title: 'Second', thumbnail: '', itemCount: 2 })
    updateConfig({ fallbackPlaylist: { playlistId: 'PLsecond00000001' } })

    const playlists = await list()

    assert.deepEqual(
      playlists.filter((playlist) => playlist.id.startsWith('PLfirst') || playlist.id.startsWith('PLsecond')).map((playlist) => [playlist.id, playlist.isActive]),
      [
        ['PLfirst000000001', false],
        ['PLsecond00000001', true]
      ]
    )
  })
})

test('DELETE /api/playlists/:id', async (t) => {
  await t.test('a malformed id is rejected by the shared param check before the route runs', async () => {
    const response = await fetch(`${base}/oops`, { method: 'DELETE' })

    assert.equal(response.status, 400)
    assert.equal(((await response.json()) as Record<string, any>).code, 'INVALID_PLAYLIST_ID')
  })

  await t.test('answers with the playlists that are left, with their active marks, and says when it cleared the active one', async () => {
    updateConfig({ fallbackPlaylist: { playlistId: 'PLsecond00000001' } })

    const response = await fetch(`${base}/PLsecond00000001`, { method: 'DELETE' })
    const body = (await response.json()) as Record<string, any>

    assert.equal(response.status, 200)
    assert.equal(body.data.fallbackCleared, true)
    assert.equal(
      body.data.playlists.some((playlist: { isActive: boolean }) => playlist.isActive),
      false
    )
    assert.equal(getConfig().fallbackPlaylist.playlistId, null)
  })
})
