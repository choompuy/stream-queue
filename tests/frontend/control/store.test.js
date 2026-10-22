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
})
