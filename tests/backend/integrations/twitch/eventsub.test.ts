import { test, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws'
import { TwitchEventSub } from '../../../../src/integrations/twitch/eventsub.js'
import { CHANNEL_POINTS_REDEMPTION, type TwitchClient } from '../../../../src/integrations/twitch/client.js'
import type { TwitchChannelPointsRedemption } from '../../../../src/integrations/twitch/types.js'
import { getActivity, clearActivity } from '../../../../src/activity.js'

// EventSub, as far as the app is concerned: a socket that says "welcome", then sends notifications. A local server plays Twitch.
// The journal of a lost connection lives in data/activity.json: keep the test away from the real one
process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-eventsub-test-')))

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
  protected timing = { initialDelayMs: 5, maxDelayMs: 20, readyTimeoutMs: 300, stableAfterMs: 0 }

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

  await t.test('a refused subscription is answered by the rejected connect(), not by an error line of its own', async () => {
    const { sub } = await setup({ failSubscribe: new Error('subscription refused') })
    const lines: string[] = []
    const realError = console.error
    console.error = (line: string) => { lines.push(line) }

    try {
      await assert.rejects(sub.connect(), /subscription refused/)
      await pause(20) // the teardown after the refusal finishes in the background
    } finally {
      console.error = realError
    }

    // connectOrRetry() in the integration reports the same failure once, with the retry plan; the socket
    // itself must stay silent, or every attempt is an error line twice over
    assert.equal(lines.filter((line) => line.includes('subscription')).length, 0)
  })
})

test('TwitchEventSub: a connection lost to the outside', async (t) => {
  await t.test('a blip under the threshold reconnects without a line in the journal', async () => {
    const { sub, server } = await setup()
    clearActivity()
    await sub.connect()

    // the network drops the connection: the socket reconnects by itself (the test timing retries within milliseconds)
    server.dropClients()
    await until(() => server.connections() >= 2, 'the reconnection')
    await until(() => sub.isConnected(), 'the session to be ready again')

    assert.equal(getActivity().some((entry) => entry.reasonCode === 'TWITCH_CONNECTION_LOST'), false)
  })

  await t.test('an outage long enough to miss redemptions leaves one line in the journal', async () => {
    const { sub, server } = await setup()
    // the real threshold is a minute (a blip stays out of the journal); here only the arithmetic is tested
    ;(sub as unknown as { journalAfterMs: number }).journalAfterMs = 0
    clearActivity()
    await sub.connect()

    server.dropClients()
    await until(() => getActivity().some((entry) => entry.reasonCode === 'TWITCH_CONNECTION_LOST'), 'the journal line')

    const entry = getActivity().find((entry) => entry.reasonCode === 'TWITCH_CONNECTION_LOST')
    assert.equal(entry?.status, 'failed')
    assert.equal(entry?.requestedBy, 'Twitch')
  })

  await t.test('an intentional disconnect journals nothing', async () => {
    const { sub } = await setup()
    ;(sub as unknown as { journalAfterMs: number }).journalAfterMs = 0
    clearActivity()
    await sub.connect()

    await sub.disconnect()
    await sub.connect()
    await until(() => sub.isConnected(), 'the session to be ready again')

    assert.equal(getActivity().some((entry) => entry.reasonCode === 'TWITCH_CONNECTION_LOST'), false)
  })
})

test('TwitchEventSub: the outage line is written when the threshold is crossed, not when the outage ends', async (t) => {
  // The real threshold is a minute; these subtests keep it real and drive the clock by hand instead. The
  // socket talks to a local server over real I/O, so waiting is done with setImmediate - it survives the mocked
  // timers - and the clock itself is mocked too: the minutes of the journal line are counted with Date.now().
  const drainUntil = async (condition: () => boolean, what: string) => {
    for (let i = 0; i < 1000 && !condition(); i++) await new Promise((resolve) => setImmediate(resolve))
    if (!condition()) assert.fail(`timed out waiting for: ${what}`)
  }

  const lostLines = () => getActivity().filter((entry) => entry.reasonCode === 'TWITCH_CONNECTION_LOST')

  await t.test('an outage that never ends leaves exactly one line, written by the timer with the minutes known then', async () => {
    const { sub, server, login } = await setup()
    ;(sub as unknown as { journalAfterMs: number }).journalAfterMs = 60_000
    await sub.connect()
    login.refused = true // the saved login is gone: no reconnection will end the outage instead of the timer
    clearActivity()

    mock.timers.enable({ apis: ['setTimeout', 'Date'] })
    try {
      server.dropClients()
      await drainUntil(() => (sub as unknown as { journalTimer: unknown }).journalTimer !== null, 'the outage alarm to be armed')

      mock.timers.tick(60_001)
      await drainUntil(() => lostLines().length === 1, 'the journal line')

      // still no second connection: the line is there anyway, and only one, saying what was known at the time
      assert.deepEqual(lostLines()[0].reasonParams, { minutes: 1 })
      assert.equal(server.connections(), 1)
    } finally {
      mock.timers.reset()
    }
  })

  await t.test('a recovery under the threshold cancels the alarm and leaves the journal silent', async () => {
    const { sub, server } = await setup()
    ;(sub as unknown as { journalAfterMs: number }).journalAfterMs = 60_000
    clearActivity()
    await sub.connect()

    mock.timers.enable({ apis: ['setTimeout', 'Date'] })
    try {
      server.dropClients()
      await drainUntil(() => (sub as unknown as { journalTimer: unknown }).journalTimer !== null, 'the outage alarm to be armed')

      mock.timers.tick(5) // the 5 ms reconnect delay of the test timing: the recovery starts, the 60 s alarm stays pending
      await drainUntil(() => sub.isConnected(), 'the session to be ready again')
      assert.equal((sub as unknown as { journalTimer: unknown }).journalTimer, null, 'the recovery cancelled the alarm')

      mock.timers.tick(120_000) // had the alarm survived, its line would be written here
      assert.equal(lostLines().length, 0)
    } finally {
      mock.timers.reset()
    }
  })

  await t.test('a recovery over the threshold keeps the one line and corrects it to the real length', async () => {
    const { sub, server } = await setup()
    ;(sub as unknown as { journalAfterMs: number }).journalAfterMs = 60_000
    // the first reconnect of the test timing is pushed past the threshold: the outage outlives it,
    // so the journal line is written before the connection is back
    ;(sub as unknown as { timing: { initialDelayMs: number } }).timing.initialDelayMs = 180_000
    await sub.connect()
    clearActivity()

    mock.timers.enable({ apis: ['setTimeout', 'Date'] })
    try {
      server.dropClients()
      await drainUntil(() => (sub as unknown as { journalTimer: unknown }).journalTimer !== null, 'the outage alarm to be armed')

      // the outage crosses the threshold while the reconnection is still a minute away: the line says the one minute known then
      mock.timers.tick(60_001)
      await drainUntil(() => lostLines().length === 1, 'the journal line')
      assert.deepEqual(lostLines()[0].reasonParams, { minutes: 1 }, 'written with the minutes known at the threshold')

      // the connection only comes back at the third minute: no second line, the first one learns the real length
      mock.timers.tick(120_000)
      await drainUntil(() => sub.isConnected(), 'the session to be ready again')

      assert.equal(lostLines().length, 1, 'exactly one line: the recovery corrected it, it did not add one')
      assert.deepEqual(lostLines()[0].reasonParams, { minutes: 3 }, 'the line states the real length of the outage')
    } finally {
      mock.timers.reset()
    }
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
