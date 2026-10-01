import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPoller } from '../../../public/js/control/polling.js'

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

test('createPoller', async (t) => {
  await t.test('runs each task on its own interval', async () => {
    let calls = 0
    const poller = createPoller([{ run: () => calls++, every: 10 }])

    poller.start()
    await wait(35)
    poller.stop()

    assert.ok(calls >= 2, `expected at least 2 calls, got ${calls}`)
  })

  await t.test('stop() prevents further calls', async () => {
    let calls = 0
    const poller = createPoller([{ run: () => calls++, every: 10 }])

    poller.start()
    await wait(15)
    poller.stop()
    const callsAtStop = calls
    await wait(30)

    assert.equal(calls, callsAtStop)
  })

  await t.test('shouldRun() gates every tick, not just the first', async () => {
    let calls = 0
    let allowed = false
    const poller = createPoller([{ run: () => calls++, every: 10 }], { shouldRun: () => allowed })

    poller.start()
    await wait(25)
    assert.equal(calls, 0)

    allowed = true
    await wait(25)
    poller.stop()
    assert.ok(calls >= 1)
  })

  await t.test('a slow task is not started again while it is still running', async () => {
    let concurrent = 0
    let maxConcurrent = 0
    const task = {
      every: 5,
      run: async () => {
        concurrent++
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        await wait(30)
        concurrent--
      }
    }
    const poller = createPoller([task])

    poller.start()
    await wait(50)
    poller.stop()
    await wait(35) // let the last in-flight run finish before the test process exits

    assert.equal(maxConcurrent, 1)
  })

  await t.test('start() is idempotent - calling it twice does not double the interval', async () => {
    let calls = 0
    const poller = createPoller([{ run: () => calls++, every: 10 }])

    poller.start()
    poller.start()
    await wait(25)
    poller.stop()

    assert.ok(calls <= 3, `expected ~2 calls from a single interval, got ${calls}`)
  })
})
