import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connectEvents, serialized } from '../../public/js/sse.js'

// What a browser gives the page: named events only (a ": comment" never reaches it), a readyState, and close()
class FakeEventSource {
  static instances = []

  constructor(url) {
    this.url = url
    this.readyState = 0
    this.closed = false
    this.listeners = {}
    FakeEventSource.instances.push(this)
  }

  addEventListener(name, listener) {
    ;(this.listeners[name] ??= []).push(listener)
  }

  close() {
    this.closed = true
    this.readyState = 2
  }

  emit(name, data) {
    for (const listener of this.listeners[name] ?? []) listener({ data: data === undefined ? undefined : JSON.stringify(data) })
  }

  open() {
    this.readyState = 1
    this.emit('open')
  }

  change(topic) {
    this.emit('changed', { topic, seq: 1 })
  }
}

function connect(t, topics = ['state', 'activity']) {
  FakeEventSource.instances = []
  t.mock.timers.enable({ apis: ['setTimeout'] })

  const changes = []
  const statuses = []
  const connection = connectEvents({
    topics,
    onChange: (topic) => changes.push(topic),
    onStatus: (status) => statuses.push(status),
    EventSourceImpl: FakeEventSource
  })

  return { changes, statuses, connection, source: () => FakeEventSource.instances.at(-1) }
}

test('connectEvents()', async (t) => {
  await t.test('asks for the topics it needs', (t) => {
    const { source } = connect(t, ['state', 'twitch'])
    assert.equal(source().url, '/api/events?topics=state,twitch')
  })

  await t.test('without EventSource it reports "down" at once and does nothing else', () => {
    const statuses = []
    const connection = connectEvents({ topics: ['state'], onChange: () => {}, onStatus: (s) => statuses.push(s), EventSourceImpl: undefined })

    assert.deepEqual(statuses, ['down'])
    assert.doesNotThrow(() => connection.close())
  })

  await t.test('on open it reports "open" and asks for every topic to be read again', (t) => {
    const { source, changes, statuses } = connect(t)

    source().open()
    t.mock.timers.tick(100)

    assert.deepEqual(statuses, ['open'])
    assert.deepEqual(changes, ['state', 'activity'])
  })

  await t.test('changes of one topic that follow each other are one call', (t) => {
    const { source, changes } = connect(t)
    source().open()
    t.mock.timers.tick(100)
    changes.length = 0

    source().change('state')
    source().change('state')
    source().change('state')
    source().change('activity')
    t.mock.timers.tick(100)

    assert.deepEqual(changes, ['state', 'activity'])
  })

  await t.test('a topic it did not ask for is ignored', (t) => {
    const { source, changes } = connect(t, ['state'])
    source().open()
    t.mock.timers.tick(100)
    changes.length = 0

    source().change('twitch')
    t.mock.timers.tick(100)

    assert.deepEqual(changes, [])
  })

  await t.test('after a drop the browser reconnects by itself and the page reads everything again', (t) => {
    const { source, changes } = connect(t)
    source().open()
    t.mock.timers.tick(100)
    changes.length = 0

    source().readyState = 0
    source().emit('error')
    source().open() // the browser reconnected
    t.mock.timers.tick(100)

    assert.deepEqual(changes, ['state', 'activity'])
  })

  await t.test('no connection for 10 seconds is "down", and a connection that comes back is "open" again', (t) => {
    const { source, statuses } = connect(t)

    t.mock.timers.tick(9999)
    assert.deepEqual(statuses, [])

    t.mock.timers.tick(1)
    assert.deepEqual(statuses, ['down'])

    source().open()
    assert.deepEqual(statuses, ['down', 'open'])
  })

  await t.test('a short drop is not reported at all', (t) => {
    const { source, statuses } = connect(t)
    source().open()

    source().readyState = 0
    source().emit('error')
    t.mock.timers.tick(5000)
    source().open()
    t.mock.timers.tick(20000)

    assert.deepEqual(statuses, ['open'])
  })

  await t.test('when the browser gives up (an error answer) it is opened again after 3 seconds', (t) => {
    const { source } = connect(t)
    const first = source()

    first.readyState = 2
    first.emit('error')
    assert.equal(FakeEventSource.instances.length, 1)

    t.mock.timers.tick(3000)

    assert.equal(FakeEventSource.instances.length, 2)
    assert.equal(first.closed, true)
  })

  await t.test('a minute without a single frame (a ping counts) opens a new connection', (t) => {
    const { source } = connect(t)
    const first = source()
    first.open()

    t.mock.timers.tick(59000)
    first.emit('ping')
    t.mock.timers.tick(59000)
    assert.equal(FakeEventSource.instances.length, 1, 'a ping keeps the connection')

    t.mock.timers.tick(1000)
    assert.equal(FakeEventSource.instances.length, 2)
    assert.equal(first.closed, true)
  })

  await t.test('close() stops everything, and nothing is called afterwards', (t) => {
    const { source, connection, changes } = connect(t)
    const first = source()
    first.open()

    connection.close()
    first.change('state')
    t.mock.timers.tick(120000)

    assert.equal(first.closed, true)
    assert.deepEqual(changes, [])
    assert.equal(FakeEventSource.instances.length, 1)
  })
})

test('serialized()', async (t) => {
  await t.test('a request while the task runs makes it run once more, not in parallel', async () => {
    const log = []
    let release
    const task = serialized(async () => {
      log.push('start')
      await new Promise((resolve) => (release = resolve))
      log.push('end')
    })

    const first = task()
    await Promise.resolve()
    task()
    task()
    release()
    await new Promise((resolve) => setImmediate(resolve))
    release()
    await first

    assert.deepEqual(log, ['start', 'end', 'start', 'end'])
  })

  await t.test('after a failure the next request still runs', async () => {
    let calls = 0
    const task = serialized(async () => {
      if (++calls === 1) throw new Error('boom')
    })

    await assert.rejects(task(), /boom/)
    await task()

    assert.equal(calls, 2)
  })
})
