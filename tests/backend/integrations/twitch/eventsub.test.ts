import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws'
import { TwitchEventSub } from '../../../../src/integrations/twitch/eventsub.js'
import { CHANNEL_POINTS_REDEMPTION, type TwitchClient } from '../../../../src/integrations/twitch/client.js'
import type { TwitchChannelPointsRedemption } from '../../../../src/integrations/twitch/types.js'

// EventSub, as far as the app is concerned: a socket that says "welcome", then sends notifications. A local server plays Twitch.

let counter = 0
const meta = (type: string, id = `m-${++counter}`) => ({ message_id: id, message_type: type, message_timestamp: new Date().toISOString() })

const welcome = (sessionId = 'sess-1', keepalive = 10) =>
  JSON.stringify({ metadata: meta('session_welcome'), payload: { session: { id: sessionId, status: 'connected', keepalive_timeout_seconds: keepalive } } })

const notification = (event: unknown, { id, type = CHANNEL_POINTS_REDEMPTION }: { id?: string; type?: string } = {}) =>
  JSON.stringify({
    metadata: meta('notification', id),
    payload: { subscription: { id: 'sub-1', type, version: '1', status: 'enabled', condition: {} }, event }
  })

const redemption = (id: string) => ({ id, user_name: 'viewer', reward: { id: 'reward-1', title: 'Song request' } }) as unknown as TwitchChannelPointsRedemption

async function until(condition: () => boolean, what: string, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) assert.fail(`timed out waiting for: ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type ServerOptions = { welcomeMessage?: (connection: number) => string | null }

async function startServer({ welcomeMessage = () => welcome() }: ServerOptions = {}) {
  const server = new WebSocketServer({ port: 0 })
  const clients = new Set<ServerSocket>()
  let connections = 0

  server.on('connection', (client) => {
    connections++
    clients.add(client)
    client.on('close', () => clients.delete(client))

    const first = welcomeMessage(connections)
    if (first) client.send(first)
  })
  await new Promise((resolve) => server.once('listening', resolve))

  const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`

  return {
    url,
    connections: () => connections,
    openClients: () => clients.size,
    send: (message: string) => [...clients].at(-1)?.send(message),
    dropClients: () => clients.forEach((client) => client.terminate()),
    stop: async () => {
      clients.forEach((client) => client.terminate())
      await new Promise((resolve) => server.close(resolve))
    }
  }
}

class TestEventSub extends TwitchEventSub {
  watchdogs: number[] = []
  protected timing = { initialDelayMs: 5, maxDelayMs: 20, maxAttempts: Infinity, readyTimeoutMs: 300, stableAfterMs: 0 }

  constructor(url: string, client: TwitchClient, onRedemption?: (event: TwitchChannelPointsRedemption) => void) {
    super({ client, onChannelPointsRedemption: onRedemption })
    // the address of Twitch is fixed in the class: the test points the socket at its own server
    ;(this as unknown as { url: string }).url = url
  }

  // the real watchdog waits at least 15 s: the threshold is recorded instead of armed
  protected startWatchdog(ms: number): void {
    this.watchdogs.push(ms)
  }
}

function stubClient({ failSubscribe }: { failSubscribe?: Error } = {}) {
  const subscribed: string[] = []
  const login = { refused: false }
  const client = {
    subscribeToRedemptions: async (sessionId: string) => {
      if (failSubscribe) throw failSubscribe
      subscribed.push(sessionId)
    },
    needsReauthorization: () => login.refused
  } as unknown as TwitchClient

  return { client, subscribed, login }
}

const open: Array<{ stop: () => Promise<void> }> = []
const sockets: TestEventSub[] = []

async function setup(options: ServerOptions & { failSubscribe?: Error } = {}) {
  const server = await startServer(options)
  const { client, subscribed, login } = stubClient({ failSubscribe: options.failSubscribe })
  const events: TwitchChannelPointsRedemption[] = []
  const sub = new TestEventSub(server.url, client, (event) => void events.push(event))

  open.push(server)
  sockets.push(sub)
  return { server, sub, subscribed, login, events }
}

after(async () => {
  await Promise.all(sockets.map((socket) => socket.disconnect()))
  await Promise.all(open.map((server) => server.stop()))
})

test('TwitchEventSub: connecting', async (t) => {
  await t.test('subscribes with the session id from the welcome, and the connection is ready', async () => {
    const { sub, subscribed } = await setup({ welcomeMessage: () => welcome('session-42') })

    await sub.connect()

    assert.deepEqual(subscribed, ['session-42'])
  })

  await t.test('the silence limit is the announced timeout with a margin, never under 15 seconds', async () => {
    const short = await setup({ welcomeMessage: () => welcome('s', 10) })
    await short.sub.connect()
    assert.deepEqual(short.sub.watchdogs, [15_000])

    const long = await setup({ welcomeMessage: () => welcome('s', 30) })
    await long.sub.connect()
    assert.deepEqual(long.sub.watchdogs, [45_000])
  })

  await t.test('a welcome without a session fails the connection', async () => {
    const { sub } = await setup({ welcomeMessage: () => JSON.stringify({ metadata: meta('session_welcome'), payload: {} }) })
    await assert.rejects(sub.connect(), /no session/)
  })

  await t.test('a refused subscription fails the connection with the reason', async () => {
    const { sub } = await setup({ failSubscribe: new Error('subscription refused') })
    await assert.rejects(sub.connect(), /subscription refused/)
  })
})

test('TwitchEventSub: redemptions', async (t) => {
  await t.test('a redemption notification reaches the handler', async () => {
    const { sub, server, events } = await setup()
    await sub.connect()

    server.send(notification(redemption('r1')))
    await until(() => events.length === 1, 'the redemption')

    assert.equal(events[0].id, 'r1')
  })

  await t.test('notifications that are not redemptions, have no subscription or carry a broken event are skipped', async () => {
    const { sub, server, events } = await setup()
    await sub.connect()

    server.send(notification(redemption('other-type'), { type: 'channel.follow' }))
    server.send(JSON.stringify({ metadata: meta('notification'), payload: { event: redemption('no-subscription') } }))
    server.send(notification(null))
    server.send(notification('not an object'))
    server.send(notification(redemption('good')))
    await until(() => events.length === 1, 'the valid redemption')

    assert.deepEqual(events.map((event) => event.id), ['good'])
  })

  await t.test('a notification Twitch delivers twice (same message id) is handled once', async () => {
    const { sub, server, events } = await setup()
    await sub.connect()

    server.send(notification(redemption('r1'), { id: 'same-message' }))
    server.send(notification(redemption('r1'), { id: 'same-message' }))
    server.send(notification(redemption('r2'), { id: 'another-message' }))
    await until(() => events.length === 2, 'both different redemptions')
    await pause(50)

    assert.deepEqual(events.map((event) => event.id), ['r1', 'r2'])
  })

  await t.test('only the last 100 message ids are remembered', async () => {
    const { sub, server, events } = await setup()
    await sub.connect()

    for (let i = 0; i < 101; i++) server.send(notification(redemption(`r${i}`), { id: `message-${i}` }))
    await until(() => events.length === 101, '101 different messages')

    server.send(notification(redemption('again'), { id: 'message-0' })) // forgotten by now
    await until(() => events.length === 102, 'the oldest message id to be accepted again')

    server.send(notification(redemption('twice'), { id: 'message-100' })) // still remembered
    await pause(50)
    assert.equal(events.length, 102)
  })

  await t.test('keepalives, unknown message types and broken JSON are ignored and do not drop the connection', async () => {
    const { sub, server, events } = await setup()
    await sub.connect()

    server.send(JSON.stringify({ metadata: meta('session_keepalive'), payload: {} }))
    server.send(JSON.stringify({ metadata: meta('something_new'), payload: {} }))
    server.send('this is not json')
    server.send(notification(redemption('after')))
    await until(() => events.length === 1, 'the redemption after the noise')

    assert.equal(server.connections(), 1)
  })
})

test('TwitchEventSub: session changes', async (t) => {
  await t.test('a reconnect request moves to the new address without subscribing again, and closes the old connection', async () => {
    const { sub, server, subscribed, events } = await setup()
    await sub.connect()

    server.send(JSON.stringify({ metadata: meta('session_reconnect'), payload: { session: { id: 'sess-1', status: 'reconnecting', keepalive_timeout_seconds: 10, reconnect_url: server.url } } }))
    await until(() => server.connections() === 2, 'the second connection')
    await until(() => server.openClients() === 1, 'the old connection to be closed')

    assert.deepEqual(subscribed, ['sess-1'], 'the subscription carries over to the new session')
    assert.equal(sub.watchdogs.length, 2, 'the silence limit is armed again for the new session')

    server.send(notification(redemption('on-new-session')))
    await until(() => events.length === 1, 'a redemption on the new connection')
  })

  await t.test('a reconnect request without an address changes nothing', async () => {
    const { sub, server, subscribed } = await setup()
    await sub.connect()

    server.send(JSON.stringify({ metadata: meta('session_reconnect'), payload: { session: { id: 'sess-1', status: 'reconnecting', keepalive_timeout_seconds: 10 } } }))
    await pause(80)

    assert.equal(server.connections(), 1)
    assert.deepEqual(subscribed, ['sess-1'])
  })

  await t.test('a revoked subscription starts a new session and subscribes again', async () => {
    const { sub, server, subscribed } = await setup({ welcomeMessage: (connection) => welcome(`sess-${connection}`) })
    await sub.connect()

    server.send(JSON.stringify({ metadata: meta('revocation'), payload: { subscription: { id: 'sub-1', type: CHANNEL_POINTS_REDEMPTION, version: '1', status: 'authorization_revoked', condition: {} } } }))
    await until(() => subscribed.length === 2, 'the second subscription')

    assert.deepEqual(subscribed, ['sess-1', 'sess-2'])
  })
})

test('TwitchEventSub: a lost connection', async (t) => {
  await t.test('comes back by itself, in a new session that is subscribed again', async () => {
    const { sub, server, subscribed } = await setup({ welcomeMessage: (connection) => welcome(`sess-${connection}`) })
    await sub.connect()

    server.dropClients()
    await until(() => subscribed.length === 2, 'the subscription of the new session')

    assert.deepEqual(subscribed, ['sess-1', 'sess-2'])
  })

  await t.test('does not come back while Twitch refuses the saved login', async () => {
    const { sub, server, login } = await setup()
    await sub.connect()

    login.refused = true
    server.dropClients()
    await pause(150) // many retry delays at the 5 ms of the test

    assert.equal(server.connections(), 1)
  })
})
