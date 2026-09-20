import { test } from 'node:test'
import assert from 'node:assert/strict'
import { onStateChange, notifyStateChange } from './state-events.js'

test('state change listeners', async (t) => {
  await t.test('every listener is called on each notification', () => {
    const calls: string[] = []
    const off1 = onStateChange(() => calls.push('a'))
    const off2 = onStateChange(() => calls.push('b'))

    notifyStateChange()
    off1()
    off2()

    assert.deepEqual(calls, ['a', 'b'])
  })

  await t.test('a throwing listener neither stops the others nor throws into the caller', (t) => {
    const errors = t.mock.method(console, 'error', () => {})
    const calls: string[] = []
    const off = [
      onStateChange(() => calls.push('before')),
      onStateChange(() => {
        throw new Error('boom')
      }),
      onStateChange(() => calls.push('after'))
    ]

    assert.doesNotThrow(() => notifyStateChange())
    off.forEach((fn) => fn())

    assert.deepEqual(calls, ['before', 'after'])
    assert.equal(errors.mock.callCount(), 1)
  })

  await t.test('unsubscribing stops notifications', () => {
    let count = 0
    const off = onStateChange(() => count++)

    notifyStateChange()
    off()
    notifyStateChange()

    assert.equal(count, 1)
  })

  await t.test('registering the same function twice notifies it once', () => {
    let count = 0
    const listener = () => count++
    const off = onStateChange(listener)
    onStateChange(listener)

    notifyStateChange()
    off()

    assert.equal(count, 1)
  })

  await t.test('a listener may unsubscribe itself while being notified', () => {
    const calls: string[] = []
    const offSelf = onStateChange(() => {
      calls.push('self')
      offSelf()
    })
    const offOther = onStateChange(() => calls.push('other'))

    notifyStateChange()
    notifyStateChange()
    offOther()

    assert.deepEqual(calls, ['self', 'other', 'other'])
  })
})
