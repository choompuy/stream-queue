import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const express = (await import('express')).default
const { router } = await import('../../../src/routes/queue.js')
const { updateSecrets } = await import('../../../src/secrets.js')
const queue = await import('../../../src/queue.js')
const player = await import('../../../src/player.js')
const { getActivity, clearActivity } = await import('../../../src/activity.js')

updateSecrets({ youtubeApiKey: 'test-key' })

// YouTube is stubbed: any video id exists and is a 3 minute song with that id as its title
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input instanceof Request ? input.url : input))
  if (url.hostname !== 'www.googleapis.com') return realFetch(input, init)

  const id = url.searchParams.get('id') ?? ''
  const item = {
    id,
    snippet: { title: `Song ${id}`, channelTitle: 'Channel', thumbnails: { medium: { url: 'https://img/x.jpg' } } },
    contentDetails: { duration: 'PT3M' },
    statistics: { viewCount: '1000000' }
  }
  return new Response(JSON.stringify({ items: [item] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

const app = express()
app.use(express.json())
app.use('/api/queue', router)
app.get('/api/state', (_req, res) => res.json({ success: true, ...player.getState() }))

const server = app.listen(0)
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`
after(() => server.close())

const A = 'aaaaaaaaaaa'
const B = 'bbbbbbbbbbb'

beforeEach(() => {
  queue.clearQueue()
  queue.setCurrent(null)
  clearActivity()
})

const request = (body: unknown) =>
  fetch(`${base}/queue/request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const asAdmin = (videoId: string, requestedBy = 'viewer') => ({ query: `https://www.youtube.com/watch?v=${videoId}`, requestedBy, admin: true })

test('POST /api/queue/request', async (t) => {
  await t.test('a song requested while nothing plays starts at once', async () => {
    const response = await request(asAdmin(A))
    const { data } = (await response.json()) as Record<string, any>

    assert.equal(response.status, 201)
    assert.equal(data.started, true)
    assert.equal(data.position, 0)
    assert.equal(data.song.videoId, A)
    assert.equal(data.state.current.videoId, A)
    assert.equal(typeof data.message, 'string')
    assert.ok(data.message.includes(`Song ${A}`))
  })

  await t.test('a second song is queued, and the response carries the same complete state as GET /state', async () => {
    await request(asAdmin(A))
    const response = await request(asAdmin(B, 'amy'))
    const { data } = (await response.json()) as Record<string, any>

    assert.equal(data.started, false)
    assert.equal(data.position, 1)
    assert.deepEqual(
      data.state.queue.map((item: { videoId: string }) => item.videoId),
      [B]
    )
    assert.equal(data.state.nextTrack.videoId, B, 'nextTrack used to be missing from this response')

    const { success: _success, ...state } = (await (await fetch(`${base}/state`)).json()) as Record<string, any>
    assert.deepEqual(data.state, state)
  })

  await t.test('accepted requests are written to the activity log', async () => {
    await request(asAdmin(A, 'bob'))

    assert.equal(getActivity().length, 1)
    assert.equal(getActivity()[0].status, 'accepted')
    assert.equal(getActivity()[0].requestedBy, 'bob')
  })

  await t.test('a missing username is a 400 USERNAME_REQUIRED', async () => {
    const response = await request({ query: 'some song', requestedBy: '  ' })

    assert.equal(response.status, 400)
    assert.equal(((await response.json()) as Record<string, any>).code, 'USERNAME_REQUIRED')
  })

  await t.test('a refused request is logged as rejected with its reason', async () => {
    await request(asAdmin(A))
    const response = await request(asAdmin(A, 'amy')) // already queued/playing

    assert.equal(response.status, 409)
    const rejected = getActivity().find((entry) => entry.status === 'rejected')
    assert.equal(rejected?.reasonCode, 'DUPLICATE')
    assert.equal(rejected?.requestedBy, 'amy')
  })
})
