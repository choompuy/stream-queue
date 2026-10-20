import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const express = (await import('express')).default
const { router } = await import('../../../src/routes/settings.js')
const { errorHandler } = await import('../../../src/error-handler.js')
const { updateTwitchOAuthState, updateSecrets } = await import('../../../src/secrets.js')

const app = express()
app.use(express.json())
app.use('/api', router)
// the routes pass errors on with next(), the real server turns them into API errors in this handler
app.use(errorHandler)

const server = app.listen(0)
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`
after(() => server.close())

const putConfig = (body: unknown) =>
  fetch(`${base}/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const getConfig = async () => ((await fetch(`${base}/config`)).json() as Promise<Record<string, any>>).then((body) => body.data)

test('PUT /api/config', async (t) => {
  await t.test('a valid update is applied and returned', async () => {
    const response = await putConfig({ minViews: 123, fallbackPlaylist: { repeat: true } })
    const body = (await response.json()) as Record<string, any>

    assert.equal(response.status, 200)
    assert.equal(body.data.config.minViews, 123)
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

  await t.test('applies valid fields and rejects invalid fields independently', async () => {
    const before = await getConfig()

    const response = await putConfig({
      minViews: before.minViews + 1,
      maxQueueSize: -1
    })

    const config = await getConfig()

    assert.equal(response.status, 400)
    assert.equal(config.minViews, before.minViews + 1)
    assert.equal(config.maxQueueSize, before.maxQueueSize)
  })

  await t.test('unknown fields are refused and never stored', async () => {
    const response = await putConfig({ notAField: 1 })

    assert.equal(response.status, 400)
    assert.equal('notAField' in (await getConfig()), false)
  })

  await t.test('a duration range where min >= max is a 400, not a config that silently rejects every song', async () => {
    const before = await getConfig()
    const response = await putConfig({ minDurationSeconds: 500, maxDurationSeconds: 60 })
    const body = (await response.json()) as Record<string, any>

    assert.equal(response.status, 400)
    assert.equal(body.code, 'INVALID_CONFIG')
    assert.deepEqual(body.params.fields.split(', ').sort(), ['maxDurationSeconds', 'minDurationSeconds'])
    assert.deepEqual(await getConfig(), before)
  })

  await t.test('changing only one bound is checked against the stored value of the other', async () => {
    await putConfig({ minDurationSeconds: 60, maxDurationSeconds: 480 })

    const response = await putConfig({ minDurationSeconds: 500 })
    assert.equal(response.status, 400)
    assert.equal((await getConfig()).minDurationSeconds, 60)
  })
})

test('PUT /api/config and the fallback playlist', async (t) => {
  await t.test('changing shuffle sticks (it used to be flipped back by the route)', async () => {
    assert.equal((await putConfig({ fallbackPlaylist: { shuffle: true } })).status, 200)
    assert.equal((await getConfig()).fallbackPlaylist.shuffle, true)

    assert.equal((await putConfig({ fallbackPlaylist: { shuffle: false } })).status, 200)
    assert.equal((await getConfig()).fallbackPlaylist.shuffle, false)
  })

  await t.test('a malformed playlist id is refused as a field, like every other invalid value', async () => {
    const response = await putConfig({ fallbackPlaylist: { playlistId: 'not a playlist' } })
    const body = (await response.json()) as Record<string, any>

    assert.equal(response.status, 400)
    assert.equal(body.code, 'INVALID_CONFIG')
    assert.equal(body.params.fields, 'fallbackPlaylist.playlistId')
    assert.equal((await getConfig()).fallbackPlaylist.playlistId, null)
  })

  await t.test('an empty playlist id clears it', async () => {
    const response = await putConfig({ fallbackPlaylist: { playlistId: '  ' } })

    assert.equal(response.status, 200)
    assert.equal((await getConfig()).fallbackPlaylist.playlistId, null)
  })
})

test('PUT /api/config with a refused field (partial save)', async (t) => {
  await t.test('stores the valid fields and returns them together with the refused ones', async () => {
    const response = await putConfig({ minViews: 4242, maxQueueSize: -1 })
    const body = (await response.json()) as Record<string, any>

    assert.equal(response.status, 400)
    assert.equal(body.code, 'INVALID_CONFIG')
    assert.deepEqual(body.data.rejected, ['maxQueueSize'])
    assert.equal(body.data.config.minViews, 4242)
    assert.equal((await getConfig()).minViews, 4242)
  })

  await t.test('a playlist saved next to a refused field is still loaded, not just stored', async () => {
    // there is no API key in the test environment, so the load fails - which is how we can tell it was attempted
    const response = await putConfig({ minViews: -5, fallbackPlaylist: { playlistId: 'PLpartialsave01' } })
    const body = (await response.json()) as Record<string, any>

    assert.equal(response.status, 400)
    assert.equal(body.code, 'NO_API_KEY', 'the load was tried (it used to be skipped and INVALID_CONFIG came back)')
    assert.equal((await getConfig()).fallbackPlaylist.playlistId, null, 'and undone, exactly like a playlist-only save')
  })
})

test('PUT /api/settings', async (t) => {
  const putSettings = (body: unknown) =>
    fetch(`${base}/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const getSettings = async () => ((await fetch(`${base}/settings`)).json() as Promise<Record<string, any>>).then((body) => body.data)

  await t.test('valid values are applied', async () => {
    const response = await putSettings({ showVideo: true, position: 'top-left' })

    assert.equal(response.status, 200)
    assert.deepEqual(await getSettings(), { showVideo: true, hideOverlayInfo: false, opacity: 100, position: 'top-left', locale: 'en' })
  })

  await t.test('invalid and unknown fields are a 400 that names them, and the valid ones are still stored', async () => {
    const before = await getSettings()
    const response = await putSettings({ showVideo: !before.showVideo, position: 'nowhere', locale: 'xx', extra: 1 })
    const body = (await response.json()) as Record<string, any>

    assert.equal(response.status, 400)
    assert.equal(body.code, 'INVALID_CONFIG')
    assert.deepEqual(body.data.rejected.sort(), ['extra', 'locale', 'position'])
    assert.equal(body.data.config.showVideo, !before.showVideo, 'the answer is the stored settings')
    assert.deepEqual(await getSettings(), { ...before, showVideo: !before.showVideo })
  })

  await t.test('a valid save answers with the stored settings and nothing refused', async () => {
    const body = (await (await putSettings({ opacity: 40 })).json()) as Record<string, any>

    assert.deepEqual(body.data.rejected, [])
    assert.equal(body.data.config.opacity, 40)
  })
})

async function readSecretsFrom(remoteAddress: string): Promise<Record<string, any>> {
  const lan = express()
  lan.use((req, _res, next) => {
    Object.defineProperty(req.socket, 'remoteAddress', { value: remoteAddress, configurable: true })
    next()
  })
  lan.use('/api', router)

  const lanServer = lan.listen(0)
  try {
    const response = await fetch(`http://127.0.0.1:${(lanServer.address() as AddressInfo).port}/api/secrets`)
    return ((await response.json()) as Record<string, any>).data
  } finally {
    lanServer.close()
  }
}

test('GET /api/secrets and a login that waits for its code', async (t) => {
  const login = { userCode: 'ABCD-1234', verificationUri: 'https://www.twitch.tv/activate', expiresAt: Date.now() + 60_000 }
  updateTwitchOAuthState({ authorization: login })

  await t.test('this computer sees the address', async () => {
    assert.deepEqual((await readSecretsFrom('127.0.0.1')).twitch.authorization, login)
  })

  await t.test('another device on the network does not', async () => {
    assert.equal((await readSecretsFrom('192.168.1.50')).twitch.authorization, null)
  })

  updateTwitchOAuthState({ authorization: null })
})

test('PUT /api/config while a playlist is still loading', async (t) => {
  updateSecrets({ youtubeApiKey: 'test-key' })
  const realFetch = globalThis.fetch
  after(() => {
    globalThis.fetch = realFetch
  })

  await t.test('a save that does not touch the playlist is answered at once, and with its own result', async () => {
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input instanceof Request ? input.url : input))
      if (url.hostname === 'www.googleapis.com') {
        await new Promise((resolve) => setTimeout(resolve, 30))
        return new Response(JSON.stringify({ error: { message: 'refused' } }), { status: 403 })
      }
      return realFetch(input, init)
    }

    const playlistSave = putConfig({ fallbackPlaylist: { playlistId: 'PLraceslower01' } })
    await new Promise((resolve) => setTimeout(resolve, 5))

    const response = await putConfig({ minViews: 777 })

    assert.equal(response.status, 200)
    assert.equal((await getConfig()).minViews, 777)

    assert.equal((await playlistSave).status, 503)
    assert.equal((await getConfig()).fallbackPlaylist.playlistId, null, 'the failed playlist save was rolled back')
  })
})
