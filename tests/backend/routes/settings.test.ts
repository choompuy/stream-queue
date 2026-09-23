import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const express = (await import('express')).default
const { router } = await import('../../../src/routes/settings.js')

const app = express()
app.use(express.json())
app.use('/api', router)

const server = app.listen(0)
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`
after(() => server.close())

const putConfig = (body: unknown) => fetch(`${base}/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const getConfig = async () => ((await fetch(`${base}/config`)).json() as Promise<Record<string, any>>).then((body) => body.data)

test('PUT /api/config', async (t) => {
  await t.test('a valid update is applied and returned', async () => {
    const response = await putConfig({ minViews: 123, fallbackPlaylist: { repeat: true } })
    const body = (await response.json()) as Record<string, any>

    assert.equal(response.status, 200)
    assert.equal(body.data.minViews, 123)
    assert.equal((await getConfig()).fallbackPlaylist.repeat, true)
  })

  for (const value of ['x', 5, null, []]) {
    await t.test(`fallbackPlaylist = ${JSON.stringify(value)} is a 400, not a crash`, async () => {
      const response = await putConfig({ fallbackPlaylist: value })
      const body = (await response.json()) as Record<string, any>

      assert.equal(response.status, 400)
      assert.equal(body.code, 'INVALID_CONFIG')
      assert.equal(body.params.fields, 'fallbackPlaylist')
    })
  }

  await t.test('invalid fields (nested included) are named in the error', async () => {
    const response = await putConfig({ maxQueueSize: -5, fallbackPlaylist: { repeat: 'yes' } })
    const body = (await response.json()) as Record<string, any>

    assert.equal(response.status, 400)
    assert.equal(body.code, 'INVALID_CONFIG')
    assert.deepEqual(body.params.fields.split(', ').sort(), ['fallbackPlaylist.repeat', 'maxQueueSize'])
  })

  await t.test('is all-or-nothing: a valid field next to an invalid one is not applied either', async () => {
    const before = await getConfig()
    const response = await putConfig({ minViews: before.minViews + 1, maxQueueSize: 0 })

    assert.equal(response.status, 400)
    assert.equal((await getConfig()).minViews, before.minViews)
  })

  await t.test('unknown fields are refused and never stored', async () => {
    const response = await putConfig({ notAField: 1 })

    assert.equal(response.status, 400)
    assert.equal('notAField' in (await getConfig()), false)
  })
})

test('PUT /api/config and the fallback playlist', async (t) => {
  await t.test('changing shuffle sticks (it used to be flipped back by the route)', async () => {
    assert.equal((await putConfig({ fallbackPlaylist: { shuffle: true } })).status, 200)
    assert.equal((await getConfig()).fallbackPlaylist.shuffle, true)

    assert.equal((await putConfig({ fallbackPlaylist: { shuffle: false } })).status, 200)
    assert.equal((await getConfig()).fallbackPlaylist.shuffle, false)
  })

  await t.test('a malformed playlist id is a 400 INVALID_PLAYLIST_ID', async () => {
    const response = await putConfig({ fallbackPlaylist: { playlistId: 'not a playlist' } })
    const body = (await response.json()) as Record<string, any>

    assert.equal(response.status, 400)
    assert.equal(body.code, 'INVALID_PLAYLIST_ID')
  })

  await t.test('an empty playlist id clears it', async () => {
    const response = await putConfig({ fallbackPlaylist: { playlistId: '  ' } })

    assert.equal(response.status, 200)
    assert.equal((await getConfig()).fallbackPlaylist.playlistId, null)
  })

  await t.test('when the new playlist cannot be loaded nothing is kept, not even the other fields', async () => {
    const before = await getConfig()
    // no YouTube API key in the test data dir, so loading fails with NO_API_KEY
    const response = await putConfig({ minViews: before.minViews + 1, fallbackPlaylist: { playlistId: 'PLnokey0000001' } })
    const body = (await response.json()) as Record<string, any>

    assert.equal(response.status, 400)
    assert.equal(body.code, 'NO_API_KEY')
    assert.deepEqual(await getConfig(), before)
  })
})

test('PUT /api/settings', async (t) => {
  const putSettings = (body: unknown) => fetch(`${base}/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const getSettings = async () => ((await fetch(`${base}/settings`)).json() as Promise<Record<string, any>>).then((body) => body.data)

  await t.test('valid values are applied', async () => {
    const response = await putSettings({ showVideo: true, position: 'top-left' })

    assert.equal(response.status, 200)
    assert.deepEqual(await getSettings(), { showVideo: true, position: 'top-left', locale: 'en' })
  })

  await t.test('invalid and unknown fields are a 400 that names them, and nothing is applied', async () => {
    const before = await getSettings()
    const response = await putSettings({ showVideo: false, position: 'nowhere', locale: 'xx', extra: 1 })
    const body = (await response.json()) as Record<string, any>

    assert.equal(response.status, 400)
    assert.equal(body.code, 'INVALID_SETTINGS')
    assert.deepEqual(body.params.fields.split(', ').sort(), ['extra', 'locale', 'position'])
    assert.deepEqual(await getSettings(), before)
  })
})
