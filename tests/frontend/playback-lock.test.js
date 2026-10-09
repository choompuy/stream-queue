import { test } from 'node:test'
import assert from 'node:assert/strict'
import { claimPlayback } from '../../public/js/playback-lock.js'

// Web Locks as the browser does it for one name: the first request holds the lock until its callback settles, the rest wait in line
function fakeLocks() {
  const waiting = []
  let held = false

  const grant = async () => {
    if (held || waiting.length === 0) return
    held = true
    const { callback } = waiting.shift()
    try {
      await callback()
    } finally {
      held = false
      grant()
    }
  }

  return {
    request(name, callback) {
      waiting.push({ name, callback })
      return grant()
    }
  }
}

test('claimPlayback()', async (t) => {
  await t.test('without Web Locks every page plays, as before', () => {
    let granted = 0
    claimPlayback(() => granted++, undefined)
    assert.equal(granted, 1)
  })

  await t.test('only the first overlay is granted playback, the second one waits', async () => {
    const locks = fakeLocks()
    const granted = []

    claimPlayback(() => granted.push('first'), locks)
    claimPlayback(() => granted.push('second'), locks)
    await new Promise((resolve) => setImmediate(resolve))

    assert.deepEqual(granted, ['first'])
  })

  await t.test('asks for one shared lock name', () => {
    const names = []
    const locks = { request: (name) => names.push(name) }

    claimPlayback(() => {}, locks)
    claimPlayback(() => {}, locks)

    assert.equal(names.length, 2)
    assert.equal(new Set(names).size, 1)
  })

  await t.test('the lock is never released by the page itself: the callback does not settle', async () => {
    let callbackResult
    const locks = { request: (name, callback) => (callbackResult = callback()) }

    claimPlayback(() => {}, locks)

    const outcome = await Promise.race([callbackResult.then(() => 'settled'), new Promise((resolve) => setTimeout(() => resolve('held'), 30))])
    assert.equal(outcome, 'held')
  })
})
