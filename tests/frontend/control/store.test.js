import { test } from 'node:test'
import assert from 'node:assert/strict'

const { createStore } = await import('../../../public/js/control/store.js')

// a change that is followed by nothing else: the reading order of the microtasks is awaited with setImmediate
const settle = () => new Promise((resolve) => setImmediate(resolve))

test('createStore', async (t) => {
  await t.test('a subscriber of a slice is called when that slice is assigned', async () => {
    const { state, on } = createStore({ queue: [] })
    const seen = []
    on('queue', () => seen.push(state.queue))

    state.queue = [1]
    assert.deepEqual(seen, [], 'not at once: the writes of one turn are collected')
    await settle()
    assert.deepEqual(seen, [[1]])
  })

  await t.test('many writes of one turn call the subscriber once, however many slices it follows', async () => {
    const { state, on } = createStore({ queue: [], config: null, activity: [] })
    const queue = []
    const both = []
    on('queue', () => queue.push(1))
    on(['queue', 'config'], () => both.push(1))

    state.queue = [1]
    state.config = { a: 1 }
    state.queue = [1, 2]
    await settle()

    assert.deepEqual(queue, [1], 'one call for the three writes of the turn')
    assert.deepEqual(both, [1], 'and one call for a subscriber of two slices')
  })

  await t.test('a write that happens while the subscribers run is drawn too, not lost to the flush in progress', async () => {
    const { state, on } = createStore({ count: 0 })
    const seen = []

    on('count', () => {
      seen.push(state.count)
      if (state.count === 1) state.count = 2
    })

    state.count = 1
    await settle()

    assert.deepEqual(seen, [1, 2], 'the write of a subscriber is flushed again')
  })

  await t.test('writing into a field of a slice is not seen: a slice is assigned whole', async () => {
    const { state, on } = createStore({ twitch: { health: null } })
    let calls = 0
    on('twitch', () => calls++)

    state.twitch.health = { auth: 'ok' }
    await settle()
    assert.equal(calls, 0)

    state.twitch = { ...state.twitch, health: { auth: 'ok' } }
    await settle()
    assert.equal(calls, 1)
  })

  await t.test('several subscribers of one slice are all called, in the order they subscribed', async () => {
    const { state, on } = createStore({ queue: [] })
    const order = []
    on('queue', () => order.push('first'))
    on('queue', () => order.push('second'))

    state.queue = []
    await settle()
    assert.deepEqual(order, ['first', 'second'])
  })

  await t.test('a drawing that throws does not stop the others of the same change', async () => {
    const { state, on } = createStore({ a: 0, b: 0 })
    const seen = []
    on('a', () => {
      throw new Error('a drawing with a bug')
    })
    on('a', () => seen.push('second of a'))
    on('b', () => seen.push('b'))

    state.a = 1
    state.b = 1
    await settle()

    assert.deepEqual(seen, ['second of a', 'b'])
  })

  await t.test('refresh() also runs the drawings that are left after one that throws', () => {
    const { on, refresh } = createStore({ a: 0, b: 0 })
    const seen = []
    on('a', () => {
      throw new Error('boom')
    })
    on('b', () => seen.push('b'))

    refresh()

    assert.deepEqual(seen, ['b'])
  })

  await t.test('patch() changes a part of a slice by assigning the slice whole, so the subscribers see it', async () => {
    const { state, on, patch } = createStore({ twitch: { connected: false, health: null } })
    const seen = []
    on('twitch', () => seen.push({ ...state.twitch }))

    patch('twitch', { health: 'ok' })
    await settle()

    assert.deepEqual(seen, [{ connected: false, health: 'ok' }])
  })

  await t.test('a subscriber that throws does not stop the others: the panel is not left half-drawn', async () => {
    const { state, on } = createStore({ queue: [] })
    const order = []
    on('queue', () => {
      order.push('first')
      throw new Error('a broken drawing')
    })
    on('queue', () => order.push('second'))

    state.queue = [1]
    await settle()
    assert.deepEqual(order, ['first', 'second'])
  })

  await t.test('patch() merges the fields into a slice and the subscribers see it', async () => {
    const { state, on, patch } = createStore({ twitch: { health: null, user: 'a' } })
    let calls = 0
    on('twitch', () => calls++)

    patch('twitch', { health: 'ok' })
    await settle()
    assert.equal(calls, 1)
    assert.deepEqual(state.twitch, { health: 'ok', user: 'a' }, 'the fields that are not named stay')
  })

  await t.test('a patch that changes nothing assigns nothing: a drawing that patches its own slice cannot loop', async () => {
    const { state, on, patch } = createStore({ twitch: { health: null } })
    let calls = 0
    on('twitch', () => {
      calls++
      patch('twitch', { health: state.twitch.health })
    })

    patch('twitch', { health: 'ok' })
    await settle()
    assert.equal(calls, 1, 'the patch from inside the drawing changed nothing, so nothing is drawn again')
  })

  await t.test('refresh() calls a subscriber that throws and the rest as well', async () => {
    const { on, refresh } = createStore({ queue: [] })
    const order = []
    on('queue', () => {
      order.push('first')
      throw new Error('a broken drawing')
    })
    on('queue', () => order.push('second'))

    refresh()
    assert.deepEqual(order, ['first', 'second'])
  })
})

test('the panel writes into its slices only by assigning them', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = fileURLToPath(new URL('../../../public/js/control/', import.meta.url))
  const files = (dir) => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? files(join(dir, name)) : [join(dir, name)]))
  const offenders = []

  for (const file of files(root).filter((name) => name.endsWith('.js'))) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        // a comment may name the thing it forbids
        if (/^\s*(\/\/|\*)/.test(line)) return
        if (/\bstate\.[a-zA-Z]+\.[A-Za-z]+ = /.test(line)) offenders.push(`${file.slice(root.length + 1)}:${index + 1}`)
      })
  }

  assert.deepEqual(offenders, [], 'a write into a field of a slice is not seen by the subscribers: assign the slice, or patch() it')
})
