import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connectEvents, serialized, watch } from '../../public/js/sse.js'

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

  notice(payload) {
    this.emit('notice', payload)
  }
}

function connect(t, topics = ['state', 'activity']) {
  FakeEventSource.instances = []
  t.mock.timers.enable({ apis: ['setTimeout'] })

  const changes = []
  const statuses = []
  const notices = []
  const connection = connectEvents({
    topics,
    onChange: (topic) => changes.push(topic),
    onStatus: (status) => statuses.push(status),
    onNotice: (notice) => notices.push(notice),
    EventSourceImpl: FakeEventSource
  })

  return { changes, statuses, notices, connection, source: () => FakeEventSource.instances.at(-1) }
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

  await t.test('a notice is passed on as it was told, each one, not coalesced like a change', (t) => {
    const { source, notices } = connect(t)
    const first = source()
    first.open()

    first.notice({ type: 'viewerRequest', user: 'amy', title: 'One' })
    first.notice({ type: 'viewerRequest', user: 'bob', title: 'Two' })

    assert.deepEqual(notices, [
      { type: 'viewerRequest', user: 'amy', title: 'One' },
      { type: 'viewerRequest', user: 'bob', title: 'Two' }
    ])
  })

  await t.test('a notice that cannot be read is dropped without a sound', (t) => {
    const { source, notices } = connect(t)
    const first = source()
    first.open()

    assert.doesNotThrow(() => first.listeners.notice[0]({ data: '{oops' }))
    assert.deepEqual(notices, [])
  })

  await t.test('a notice counts as a frame for the watchdog, like a ping', (t) => {
    const { source } = connect(t)
    const first = source()
    first.open()

    t.mock.timers.tick(59000)
    first.notice({ type: 'viewerRequest', user: 'amy', title: 'x' })
    t.mock.timers.tick(59000)

    assert.equal(FakeEventSource.instances.length, 1)
  })

  await t.test('a page that does not ask for notices can still be told one', (t) => {
    FakeEventSource.instances = []
    t.mock.timers.enable({ apis: ['setTimeout'] })
    connectEvents({ topics: ['state'], onChange() {}, onStatus() {}, EventSourceImpl: FakeEventSource })

    assert.doesNotThrow(() => FakeEventSource.instances[0].notice({ type: 'viewerRequest', user: 'amy', title: 'x' }))
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
    const { source, connection, changes, notices } = connect(t)
    const first = source()
    first.open()

    connection.close()
    first.change('state')
    first.notice({ type: 'viewerRequest', user: 'amy', title: 'x' })
    t.mock.timers.tick(120000)

    assert.equal(first.closed, true)
    assert.deepEqual(changes, [])
    assert.deepEqual(notices, [])
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

  await t.test('a request that came during a failed run is not lost: the task runs again, and the promise follows the last run', async () => {
    let calls = 0
    let release
    const task = serialized(async () => {
      calls++
      await new Promise((resolve) => (release = resolve))
      if (calls === 1) throw new Error('boom')
    })

    const first = task()
    await Promise.resolve()
    const second = task()
    release()
    await new Promise((resolve) => setImmediate(resolve))
    release()

    assert.equal(first, second, 'every caller gets the promise of the run that is going on')
    await first
    assert.equal(calls, 2)
  })

  await t.test('a failure of the last run rejects the promise', async () => {
    const task = serialized(async () => {
      throw new Error('always')
    })

    await assert.rejects(task(), /always/)
  })
})

test('watch()', async (t) => {
  const flush = () => new Promise((resolve) => setImmediate(resolve))

  await t.test('a read that fails does not reject: nobody awaits what an event or a timer starts', async (t) => {
    FakeEventSource.instances = []
    const watcher = watch({ a: { read: async () => Promise.reject(new Error('read failed')) } }, { EventSourceImpl: FakeEventSource })
    t.after(() => watcher.close())

    await watcher.refresh('a')
    await watcher.refreshAll()
  })

  // a page with three topics: what each one reads is recorded, `shown` says what anyone looks at
  function page(t, { safetyMs = 1000, shown = {}, noEvents = false } = {}) {
    FakeEventSource.instances = []
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
    const reads = []
    const topics = Object.fromEntries(
      ['a', 'b', 'c'].map((name) => [name, { read: async () => void reads.push(name), isShown: () => shown[name] ?? true }])
    )
    const notices = []
    const watcher = watch(topics, { safetyMs, onNotice: (notice) => notices.push(notice), EventSourceImpl: noEvents ? undefined : FakeEventSource })
    t.after(() => {
      watcher.close()
      t.mock.timers.reset()
    })

    return { watcher, reads, notices, source: () => FakeEventSource.instances.at(-1) }
  }

  await t.test('follows the topics it was given, over one connection', (t) => {
    const { source } = page(t)

    assert.equal(FakeEventSource.instances.length, 1)
    assert.match(source().url, /topics=a,b,c/)
  })

  await t.test('reads the topic that the server announces, and only that one', async (t) => {
    const { source, reads } = page(t)
    source().open()
    t.mock.timers.tick(100)
    await flush()
    reads.length = 0

    source().change('b')
    t.mock.timers.tick(100)
    await flush()

    assert.deepEqual(reads, ['b'])
  })

  await t.test('reads everything each time the connection comes up: what changed while it was down was never announced', async (t) => {
    const { source, reads } = page(t)

    source().open()
    t.mock.timers.tick(100)
    await flush()

    assert.deepEqual(reads.sort(), ['a', 'b', 'c'])
  })

  await t.test('does not read a topic that nobody looks at, and refresh() of it does nothing either', async (t) => {
    const { watcher, source, reads } = page(t, { shown: { b: false } })
    source().open()
    t.mock.timers.tick(100)
    await flush()
    reads.length = 0

    source().change('b')
    watcher.refresh('b')
    t.mock.timers.tick(100)
    await flush()

    assert.deepEqual(reads, [])
  })

  await t.test('reads one topic at a time, and a change that comes while it is read makes one more read after it', async (t) => {
    FakeEventSource.instances = []
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
    let running = 0
    let peak = 0
    let started = 0
    let release = null
    const watcher = watch(
      {
        a: {
          read: async () => {
            started++
            running++
            peak = Math.max(peak, running)
            if (started === 1) await new Promise((resolve) => (release = resolve))
            running--
          }
        }
      },
      { EventSourceImpl: FakeEventSource }
    )
    t.after(() => {
      watcher.close()
      t.mock.timers.reset()
    })

    watcher.refresh('a')
    watcher.refresh('a')
    watcher.refresh('a')
    release()
    await flush()
    await flush()

    assert.equal(started, 2)
    assert.equal(peak, 1)
  })

  await t.test('while the connection is down it reads everything every safetyMs, and stops when the connection is up', async (t) => {
    const { source, reads } = page(t, { safetyMs: 1000 })

    t.mock.timers.tick(10_000)
    await flush()
    reads.length = 0

    for (let i = 0; i < 3; i++) {
      t.mock.timers.tick(1000)
      await flush()
    }
    assert.equal(reads.length, 9, 'three topics, three times')

    source().open()
    t.mock.timers.tick(100)
    await flush()
    reads.length = 0
    t.mock.timers.tick(30_000)
    await flush()
    assert.deepEqual(reads, [], 'with the connection up the server says when to read')
  })

  await t.test('with no EventSource at all it reads on its own from the start', async (t) => {
    const { reads } = page(t, { safetyMs: 1000, noEvents: true })

    t.mock.timers.tick(2000)
    await flush()

    assert.equal(reads.length, 6)
  })

  await t.test('passes the notices on, and isOpen() says whether the connection is up', async (t) => {
    const { watcher, source, notices } = page(t)
    assert.equal(watcher.isOpen(), false)

    source().open()
    source().notice({ type: 'viewerRequest', user: 'amy', title: 'x' })

    assert.equal(watcher.isOpen(), true)
    assert.deepEqual(notices, [{ type: 'viewerRequest', user: 'amy', title: 'x' }])
  })

  await t.test('close() closes the connection and ends the reading', async (t) => {
    const { watcher, source, reads } = page(t, { safetyMs: 1000 })
    t.mock.timers.tick(10_000)
    await flush()

    watcher.close()
    reads.length = 0
    t.mock.timers.tick(10_000)
    await flush()

    assert.equal(source().closed, true)
    assert.deepEqual(reads, [])
  })
})
