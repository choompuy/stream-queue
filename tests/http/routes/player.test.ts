import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const express = (await import('express')).default
const { router } = await import('../../../src/http/routes/player.js')
const queue = await import('../../../src/core/queue/service.js')
const player = await import('../../../src/core/player/service.js')
const { getActivity, clearActivity } = await import('../../../src/core/activity/service.js')

const app = express()
app.use(express.json())
app.use('/api/player', router)

const server = app.listen(0)
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/player`
after(() => server.close())

const A = 'aaaaaaaaaaa'
const B = 'bbbbbbbbbbb'
const C = 'ccccccccccc'
const D = 'ddddddddddd'

const song = (videoId: string) => ({ videoId, title: `Track ${videoId[0]}`, channelTitle: 'C', thumbnail: '', duration: 100, views: 1, url: `https://youtu.be/${videoId}` })

beforeEach(() => {
  queue.clearQueue()
  queue.setCurrent({ ...song(A), requestedBy: 'viewer' })
  for (const id of [B, C, D]) queue.addSong(song(id), 'viewer', true, true)
  clearActivity()
})

const post = (path: string, body?: unknown) =>
  fetch(`${base}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const currentId = () => player.getState().current?.videoId

test('POST /api/player/ended', async (t) => {
  await t.test('about the current track: advances', async () => {
    const body = (await (await post('ended', { videoId: A })).json()) as Record<string, any>

    assert.equal(currentId(), B)
    assert.equal(body.data.ignored, undefined)
  })

  await t.test('about a track that is no longer current: ignored, the queue does not move', async () => {
    const response = await post('ended', { videoId: D })
    const body = (await response.json()) as Record<string, any>

    assert.equal(response.status, 200)
    assert.equal(body.data.ignored, true)
    assert.equal(currentId(), A)
    assert.equal(player.getState().queue.length, 3)
  })

  await t.test('the same "ended" sent twice (two overlays) advances only once', async () => {
    await post('ended', { videoId: A })
    await post('ended', { videoId: A })

    assert.equal(currentId(), B)
  })

  await t.test('without a videoId it still means the current track (older overlays)', async () => {
    await post('ended')

    assert.equal(currentId(), B)
  })

  await t.test('a malformed videoId is a 400', async () => {
    const response = await post('ended', { videoId: 'x' })

    assert.equal(response.status, 400)
    assert.equal(currentId(), A)
  })
})

test('POST /api/player/report-failure', async (t) => {
  await t.test('the same failure reported twice skips the failed track once, not two tracks', async () => {
    await post('report-failure', { errorCode: 101, videoId: A })
    const second = (await (await post('report-failure', { errorCode: 101, videoId: A })).json()) as Record<string, any>

    assert.equal(currentId(), B)
    assert.equal(second.data.ignored, true)
    assert.equal(getActivity().filter((entry) => entry.status === 'failed').length, 1)
  })

  await t.test('a failure of an old track does not fail the current one', async () => {
    await post('report-failure', { errorCode: 100, videoId: C })

    assert.equal(currentId(), A)
    assert.equal(getActivity().length, 0)
  })

  await t.test('a failure of the current track is recorded and advances', async () => {
    const body = (await (await post('report-failure', { errorCode: 150, videoId: A })).json()) as Record<string, any>

    assert.equal(currentId(), B)
    assert.equal(getActivity()[0]?.reasonCode, 'PLAYBACK_EMBED_DISALLOWED')
    assert.equal(typeof body.data.message, 'string')
  })

  await t.test('nothing is playing: any report is ignored', async () => {
    queue.setCurrent(null)
    const body = (await (await post('report-failure', { videoId: A })).json()) as Record<string, any>

    assert.equal(body.data.ignored, true)
  })
})
