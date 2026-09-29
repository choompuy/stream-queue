import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

process.chdir(mkdtempSync(join(tmpdir(), 'twitch-test-')))

// Set required environment variables for tests
process.env.TWITCH_CLIENT_ID = 'test_client_id'

const express = (await import('express')).default
const { router: twitchRouter } = await import('../../../src/routes/twitch.js')
const { initializeTwitchIntegration } = await import('../../../src/integrations/twitch/index.js')
const { getTwitchConfig, updateTwitchConfig } = await import('../../../src/integrations/twitch/config.js')

// Initialize Twitch integration for tests
initializeTwitchIntegration({
  clientId: 'test_client_id'
})

let server: any
let port: number

const app = express()
app.use(express.json())
app.use('/api/integrations/twitch', twitchRouter)
// errors that reach Express (e.g. a handler answering twice -> ERR_HTTP_HEADERS_SENT) never show up in the
// client's response, so they are collected here and asserted on
const routeErrors: unknown[] = []
app.use((err: unknown, _req: unknown, _res: unknown, next: (e?: unknown) => void) => {
  routeErrors.push(err)
  next(err)
})
server = app.listen(0)
port = (server.address() as AddressInfo).port

after(() => {
  server.close()
})

const api = (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}/api/integrations/twitch${path}`, init)

test('twitch routes localOnly protection', async (t) => {
  await t.test('POST /connect is accessible from localhost (localOnly does not block)', async () => {
    const response = await api('/connect', { method: 'POST' })

    // The endpoint should be accessible from localhost (localOnly middleware passes through)
    // It may fail due to invalid test credentials, but should not return 403 LOCAL_ONLY
    assert.notEqual(response.status, 403)
    
    const text = await response.text()
    if (response.headers.get('content-type')?.includes('application/json')) {
      const body = JSON.parse(text) as Record<string, any>
      assert.notEqual(body.code, 'LOCAL_ONLY')
    }
  })

  await t.test('POST /disconnect is accessible from localhost (localOnly does not block)', async () => {
    const response = await api('/disconnect', { method: 'POST' })

    // Should succeed from localhost (protected by localOnly middleware)
    assert.equal(response.status, 200)
    const body = (await response.json()) as Record<string, any>
    assert.equal(body.success, true)
  })

  await t.test('POST /refresh is accessible from localhost (localOnly does not block)', async () => {
    const response = await api('/refresh', { method: 'POST' })

    // The endpoint should be accessible from localhost (localOnly middleware passes through)
    // It may fail due to no connection, but should not return 403 LOCAL_ONLY
    assert.notEqual(response.status, 403)
    
    const text = await response.text()
    if (response.headers.get('content-type')?.includes('application/json')) {
      const body = JSON.parse(text) as Record<string, any>
      assert.notEqual(body.code, 'LOCAL_ONLY')
    }
  })

  await t.test('GET /rewards is accessible from localhost (localOnly does not block)', async () => {
    const response = await api('/rewards')

    // The endpoint should be accessible from localhost (localOnly middleware passes through)
    // It may fail due to no connection, but should not return 403 LOCAL_ONLY
    assert.notEqual(response.status, 403)
    
    const text = await response.text()
    if (response.headers.get('content-type')?.includes('application/json')) {
      const body = JSON.parse(text) as Record<string, any>
      assert.notEqual(body.code, 'LOCAL_ONLY')
    }
  })

  await t.test('GET / is intentionally open for QR code/mobile panel access', async () => {
    const response = await api('/')

    // GET / is intentionally left open (no localOnly middleware)
    // This allows QR code/mobile panel to check connection status
    assert.equal(response.status, 200)
    const body = (await response.json()) as Record<string, any>
    assert.equal(body.success, true)
    assert.ok('connected' in body.data)
    assert.equal(body.data.connected, false) // No connection in test environment
  })

  await t.test('GET /config returns the current Twitch config', async () => {
    const response = await api('/config')
    assert.equal(response.status, 200)
    const body = (await response.json()) as Record<string, any>
    assert.equal(body.success, true)
    assert.ok('channelPointsRewardId' in body.data)
    assert.ok('chatCommands' in body.data)
  })

  await t.test('PUT /config updates the Twitch config', async () => {
    const response = await api('/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelPointsRewardId: 'test-reward-id' })
    })
    assert.equal(response.status, 200)
    const body = (await response.json()) as Record<string, any>
    assert.equal(body.success, true)
    assert.equal(body.data.config.channelPointsRewardId, 'test-reward-id')
  })

  await t.test('PUT /config rejects invalid config fields', async () => {
    const response = await api('/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelPointsRewardId: 123 })
    })
    assert.equal(response.status, 400)
    const body = (await response.json()) as Record<string, any>
    assert.equal(body.code, 'INVALID_CONFIG')
  })

  await t.test('PUT /config with one refused field stores the valid ones and returns both in the body, answering exactly once', async () => {
    routeErrors.length = 0

    const response = await api('/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelPointsRewardId: 'r-partial', chatCommands: { skip: { command: 'no-bang' } } })
    })
    const body = (await response.json()) as Record<string, any>

    assert.equal(response.status, 400)
    assert.equal(body.code, 'INVALID_CONFIG')
    assert.deepEqual(body.data.rejected, ['chatCommands.skip.command'])
    assert.equal(body.data.config.channelPointsRewardId, 'r-partial')
    assert.equal(getTwitchConfig().channelPointsRewardId, 'r-partial')
    assert.deepEqual(routeErrors, [], 'the handler must not try to answer a second time')
  })
})

test('twitch routes reject requests from a non-loopback address', async (t) => {
  // A second app instance with a middleware that overrides remoteAddress before localOnly runs,
  // so the actual localOnly middleware (not just isLoopbackAddress in isolation) is exercised.
  const remoteApp = express()
  remoteApp.use(express.json())
  remoteApp.use((req, _res, next) => {
    Object.defineProperty(req.socket, 'remoteAddress', { value: '192.168.1.50', configurable: true })
    next()
  })
  remoteApp.use('/api/integrations/twitch', twitchRouter)

  const remoteServer = remoteApp.listen(0)
  const remotePort = (remoteServer.address() as AddressInfo).port
  const remoteApi = (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${remotePort}/api/integrations/twitch${path}`, init)

  t.after(() => remoteServer.close())

  await t.test('POST /connect returns 403 LOCAL_ONLY', async () => {
    const response = await remoteApi('/connect', { method: 'POST' })
    assert.equal(response.status, 403)
    const body = (await response.json()) as Record<string, any>
    assert.equal(body.code, 'LOCAL_ONLY')
  })

  await t.test('POST /disconnect returns 403 LOCAL_ONLY', async () => {
    const response = await remoteApi('/disconnect', { method: 'POST' })
    assert.equal(response.status, 403)
    const body = (await response.json()) as Record<string, any>
    assert.equal(body.code, 'LOCAL_ONLY')
  })

  await t.test('POST /refresh returns 403 LOCAL_ONLY', async () => {
    const response = await remoteApi('/refresh', { method: 'POST' })
    assert.equal(response.status, 403)
    const body = (await response.json()) as Record<string, any>
    assert.equal(body.code, 'LOCAL_ONLY')
  })

  await t.test('GET /rewards returns 403 LOCAL_ONLY', async () => {
    const response = await remoteApi('/rewards')
    assert.equal(response.status, 403)
    const body = (await response.json()) as Record<string, any>
    assert.equal(body.code, 'LOCAL_ONLY')
  })

  await t.test('GET / still succeeds (intentionally open)', async () => {
    const response = await remoteApi('/')
    assert.equal(response.status, 200)
  })
})

test('twitch routes with simulated remote address', async (t) => {
  // Verify the localOnly middleware helper function works correctly
  const { isLoopbackAddress } = await import('../../../src/local-only.js')

  await t.test('isLoopbackAddress correctly identifies loopback addresses', () => {
    assert.equal(isLoopbackAddress('127.0.0.1'), true)
    assert.equal(isLoopbackAddress('::1'), true)
    assert.equal(isLoopbackAddress('192.168.1.20'), false)
    assert.equal(isLoopbackAddress('10.0.0.5'), false)
  })
})
