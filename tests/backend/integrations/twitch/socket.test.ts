import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws'
import { ReconnectingSocket } from '../../../../src/integrations/twitch/socket.js'

const logged: string[] = []

class TestSocket extends ReconnectingSocket {
  protected readonly log = {
    debug: (m: string) => void logged.push(m),
    info: (m: string) => void logged.push(m),
    log: (m: string) => void logged.push(m),
    warn: (m: string) => void logged.push(m),
    error: (m: string) => void logged.push(m)
  }
  protected readonly url: string
  protected readonly readyName = 'the test welcome'
  protected timing = { initialDelayMs: 5, maxDelayMs: 20, maxAttempts: 3, readyTimeoutMs: 150 }

  constructor(url: string) {
    super()
    this.url = url
  }

  protected onMessage(data: string): void {
    if (data === 'welcome') this.markReady()
  }

  revoke(): void {
    this.restart()
  }
}

async function until(condition: () => boolean, what: string, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) assert.fail(`timed out waiting for: ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

// A local server that says "welcome" to every client, unless `silent` is set
async function startServer(silent = false) {
  const server = new WebSocketServer({ port: 0 })
  const clients = new Set<ServerSocket>()
  let connections = 0

  server.on('connection', (client) => {
    connections++
    clients.add(client)
    client.on('close', () => clients.delete(client))
    if (!silent) client.send('welcome')
  })
  await new Promise((resolve) => server.once('listening', resolve))

  return {
    url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`,
    connections: () => connections,
    dropClients: () => clients.forEach((client) => client.terminate()),
    stop: async () => {
      clients.forEach((client) => client.terminate())
      await new Promise((resolve) => server.close(resolve))
    }
  }
}

const running: Array<() => Promise<void>> = []
after(async () => {
  for (const stop of running) await stop()
})

async function connected(silent = false) {
  const server = await startServer(silent)
  const socket = new TestSocket(server.url)
  running.push(async () => {
    await socket.disconnect()
    await server.stop()
  })
  return { server, socket }
}

test('ReconnectingSocket', async (t) => {
  await t.test('is connected once the service says it is ready, not merely when the socket opens', async () => {
    const { socket } = await connected()

    await socket.connect()

    assert.equal(socket.isConnected(), true)
  })

  await t.test('gives up on a connection that never becomes ready, and closes it', async () => {
    const { server, socket } = await connected(true)

    await assert.rejects(() => socket.connect(), /Timed out waiting for the test welcome/)

    assert.equal(socket.isConnected(), false)
    await until(() => server.connections() === 1, 'the server to have seen the attempt')
  })

  await t.test('reconnects after a drop', async () => {
    const { server, socket } = await connected()
    await socket.connect()

    server.dropClients()
    await until(() => server.connections() === 2 && socket.isConnected(), 'the reconnect')
  })

  await t.test('keeps reconnecting after MORE drops than maxAttempts, because every connection that works resets the count', async () => {
    const { server, socket } = await connected()
    await socket.connect()

    // maxAttempts is 3: it used to be a lifetime budget, so the 4th drop was the last one the bot survived
    for (let drop = 1; drop <= 6; drop++) {
      server.dropClients()
      await until(() => server.connections() === drop + 1 && socket.isConnected(), `reconnect after drop ${drop}`)
    }
  })

  await t.test('never gives up: keeps retrying long after the old attempt limit', async () => {
    const { server, socket } = await connected()
    await socket.connect()
    logged.length = 0

    await server.stop() // nothing to reconnect to any more
    await until(() => logged.filter((line) => line.startsWith('Reconnect failed')).length >= 6, 'more failed attempts than the old limit of 3')

    assert.equal(
      logged.some((line) => line.includes('giving up')),
      false
    )
    await socket.disconnect() // stops the retries
  })

  await t.test('does not reconnect after disconnect(), and can be connected again afterwards', async () => {
    const { server, socket } = await connected()
    await socket.connect()

    await socket.disconnect()
    await new Promise((resolve) => setTimeout(resolve, 60))
    assert.equal(server.connections(), 1)
    assert.equal(socket.isConnected(), false)

    await socket.connect()
    assert.equal(socket.isConnected(), true)
  })

  await t.test('restart() closes the socket and opens a fresh one', async () => {
    const { server, socket } = await connected()
    await socket.connect()

    socket.revoke()

    await until(() => server.connections() === 2 && socket.isConnected(), 'the socket to come back after a restart')
  })
})
