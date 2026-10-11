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
  retryAllowed = true
  // stableAfterMs is short, so that an ordinary test connection counts as stable almost at once
  protected timing = { initialDelayMs: 5, maxDelayMs: 20, maxAttempts: 3, readyTimeoutMs: 150, stableAfterMs: 10 }

  slowDown(stableAfterMs: number, initialDelayMs: number, maxDelayMs: number): void {
    this.timing = { ...this.timing, stableAfterMs, initialDelayMs, maxDelayMs }
  }

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

  protected canReconnect(): boolean {
    return this.retryAllowed
  }
}

async function until(condition: () => boolean, what: string, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) assert.fail(`timed out waiting for: ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

// A local server that says "welcome" to every client, unless `silent` is set.
// The first `closeFirst` connections are closed before any welcome (a drop in the middle of the handshake)
async function startServer(silent = false, closeFirst = 0) {
  const server = new WebSocketServer({ port: 0 })
  const clients = new Set<ServerSocket>()
  let connections = 0

  server.on('connection', (client) => {
    connections++
    clients.add(client)
    client.on('close', () => clients.delete(client))
    if (connections <= closeFirst) {
      setTimeout(() => client.close(), 20)
      return
    }
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

async function connected(silent = false, closeFirst = 0) {
  const server = await startServer(silent, closeFirst)
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

  await t.test('a connection that is dropped at once does not reset the reconnect pause', async () => {
    const { server, socket } = await connected()
    socket.slowDown(60_000, 20, 1000) // a connection counts as stable only after a minute
    const times: number[] = []
    await socket.connect()
    times.push(Date.now())

    for (let drop = 1; drop <= 4; drop++) {
      server.dropClients()
      await until(() => server.connections() === drop + 1 && socket.isConnected(), `reconnect after drop ${drop}`, 5000)
      times.push(Date.now())
    }

    const gaps = times.slice(1).map((time, index) => time - times[index])
    // 20, 40, 80, 160 ms in theory: each wait is longer than the one before, not the shortest every time
    assert.ok(gaps[3] >= gaps[0] * 3, `the pause grew: ${gaps.join(', ')} ms`)
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

  await t.test('stops retrying while the subclass says the login is refused, and says so once', async () => {
    const { server, socket } = await connected()
    await socket.connect()
    logged.length = 0

    socket.retryAllowed = false
    server.dropClients()
    await until(() => logged.some((line) => line.includes('Not reconnecting')), 'the notice that retries stopped')
    await new Promise((resolve) => setTimeout(resolve, 100)) // several retry delays pass

    assert.equal(server.connections(), 1, 'no new connection was tried')
    assert.equal(logged.filter((line) => line.includes('Not reconnecting')).length, 1)
    assert.equal(
      logged.some((line) => line.startsWith('Reconnect failed')),
      false
    )
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

  await t.test('a drop before the service says ready ends connect() with an error instead of hanging, and retrying brings the socket back', async () => {
    const { server, socket } = await connected(false, 1)

    const outcome = await Promise.race([
      socket.connect().then(
        () => 'connected',
        (error: Error) => error.message
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve('hung'), 1000))
    ])
    assert.match(outcome, /closed before it was ready/)

    socket.retryInBackground()
    await until(() => server.connections() === 2 && socket.isConnected(), 'the retry after the failed first attempt')
  })

  await t.test('disconnect() while connecting ends connect() and nothing is opened or brought back afterwards', async () => {
    const { server, socket } = await connected()

    const attempt = socket.connect().catch((error: Error) => error)
    await socket.disconnect()
    assert.match(String(await attempt), /Disconnected/)

    socket.retryInBackground() // what a caller of the failed connect() does
    await new Promise((resolve) => setTimeout(resolve, 60))

    assert.equal(server.connections(), 0)
    assert.equal(socket.isConnected(), false)
  })

  await t.test('two connect() calls during one attempt share it', async () => {
    const { server, socket } = await connected()

    await Promise.all([socket.connect(), socket.connect()])

    assert.equal(server.connections(), 1)
    assert.equal(socket.isConnected(), true)
  })

  await t.test('onStatusChange is called once when the connection goes up and once when it goes down', async () => {
    const { server, socket } = await connected()
    const states: boolean[] = []
    socket.onStatusChange = () => states.push(socket.isConnected())
    socket.retryAllowed = false

    await socket.connect()
    assert.deepEqual(states, [true])

    server.dropClients()
    await until(() => states.length === 2, 'the drop to be reported')
    assert.deepEqual(states, [true, false])

    await socket.disconnect()
    assert.deepEqual(states, [true, false], 'a socket that is already down does not report again')
  })

  await t.test('restart() closes the socket and opens a fresh one', async () => {
    const { server, socket } = await connected()
    await socket.connect()

    socket.revoke()

    await until(() => server.connections() === 2 && socket.isConnected(), 'the socket to come back after a restart')
  })
})
