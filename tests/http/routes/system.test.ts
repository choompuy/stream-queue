import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const express = (await import('express')).default
const { createSystemRouter } = await import('../../../src/http/routes/system.js')
const { apiRouter } = await import('../../../src/http/routes/index.js')

let exitCalls = 0
let exited: () => void = () => {}
const exitedPromise = new Promise<void>((resolve) => (exited = resolve))

const app = express()
app.use(express.json())
app.use('/api', createSystemRouter({ exit: () => (exitCalls++, exited()) }))
const server = app.listen(0)
const port = (server.address() as AddressInfo).port

const full = express()
full.use(express.json())
full.use('/api', apiRouter)
const fullServer = full.listen(0)
const fullBase = `http://127.0.0.1:${(fullServer.address() as AddressInfo).port}/api`

after(() => {
  server.close()
  fullServer.close()
})

const api = (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}/api${path}`, init)

test('system routes', async (t) => {
  await t.test('GET /state returns the complete state, next track included', async () => {
    const body = (await (await api('/state')).json()) as Record<string, any>

    assert.equal(body.success, true)
    assert.ok('current' in body.data && 'queue' in body.data && 'isPaused' in body.data && 'nextTrack' in body.data)
  })

  await t.test('GET /overlay-state returns the state and the overlay settings', async () => {
    const body = (await (await api('/overlay-state')).json()) as Record<string, any>

    assert.ok('nextTrack' in body.data.state)
    assert.deepEqual(Object.keys(body.data.settings).sort(), ['locale', 'position', 'showVideo'])
  })

  await t.test('GET /network-info reports the port the server is listening on', async () => {
    const body = (await (await api('/network-info')).json()) as Record<string, any>

    assert.equal(body.data.port, port)
    assert.ok(Array.isArray(body.data.ips) && body.data.ips.every((ip: unknown) => typeof ip === 'string'))
  })

  await t.test('POST /shutdown from this machine answers, flushes and then exits (once)', async () => {
    const response = await api('/shutdown', { method: 'POST' })

    assert.equal(response.status, 200)
    await exitedPromise
    assert.equal(exitCalls, 1)
  })
})

test('the /api route table', async (t) => {
  await t.test('every group of routes is reachable', async () => {
    const paths = ['/state', '/overlay-state', '/network-info', '/settings', '/locale', '/config', '/secrets', '/playlists', '/blocklist', '/activity', '/fallback']

    for (const path of paths) {
      const response = await fetch(`${fullBase}${path}`)
      assert.equal(response.status, 200, `GET /api${path}`)
    }
  })

  await t.test('an unknown endpoint is a JSON 404, not an HTML page', async () => {
    const response = await fetch(`${fullBase}/nope`)
    const body = (await response.json()) as Record<string, any>

    assert.equal(response.status, 404)
    assert.equal(body.code, 'NOT_FOUND')
  })

  await t.test('wrong method on a known path is also a 404 from the table', async () => {
    const response = await fetch(`${fullBase}/state`, { method: 'DELETE' })

    assert.equal(response.status, 404)
  })
})
