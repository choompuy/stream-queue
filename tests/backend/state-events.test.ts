import { test } from 'node:test'
import assert from 'node:assert/strict'
import { on, emit } from '../../src/state-events.js'

test('change listeners', async (t) => {
  await t.test('every listener is called on each notification', () => {
    const calls: string[] = []
    const off1 = on('state', () => calls.push('a'))
    const off2 = on('state', () => calls.push('b'))

    emit('state')
    off1()
    off2()

    assert.deepEqual(calls, ['a', 'b'])
  })

  await t.test('a throwing listener neither stops the others nor throws into the caller', (t) => {
    const errors = t.mock.method(console, 'error', () => {})
    const calls: string[] = []
    const off = [
      on('state', () => calls.push('before')),
      on('state', () => {
        throw new Error('boom')
      }),
      on('state', () => calls.push('after'))
    ]

    assert.doesNotThrow(() => emit('state'))
    off.forEach((fn) => fn())

    assert.deepEqual(calls, ['before', 'after'])
    assert.equal(errors.mock.callCount(), 1)
  })

  await t.test('unsubscribing stops notifications', () => {
    let count = 0
    const off = on('state', () => count++)

    emit('state')
    off()
    emit('state')

    assert.equal(count, 1)
  })

  await t.test('topics are separate: a listener only hears its own topic', () => {
    const heard: string[] = []
    const offs = [on('state', () => heard.push('state')), on('activity', () => heard.push('activity')), on('twitch', () => heard.push('twitch'))]

    emit('activity')
    emit('twitch')
    offs.forEach((off) => off())

    assert.deepEqual(heard, ['activity', 'twitch'])
  })

  await t.test('registering the same function twice notifies it once', () => {
    let count = 0
    const listener = () => count++
    const off = on('state', listener)
    on('state', listener)

    emit('state')
    off()

    assert.equal(count, 1)
  })

  await t.test('a listener may unsubscribe itself while being notified', () => {
    const calls: string[] = []
    const offSelf = on('state', () => {
      calls.push('self')
      offSelf()
    })
    const offOther = on('state', () => calls.push('other'))

    emit('state')
    emit('state')
    offOther()

    assert.deepEqual(calls, ['self', 'other', 'other'])
  })
})
