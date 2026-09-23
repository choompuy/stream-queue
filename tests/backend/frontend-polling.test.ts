import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'

const modulePath = fileURLToPath(new URL('../../public/js/control/polling.js', import.meta.url))
const { createPoller } = (await import(pathToFileURL(modulePath).href)) as {
  createPoller: (
    tasks: Array<{ run: () => Promise<void> | void; every: number }>,
    options?: { shouldRun?: () => boolean }
  ) => { start: () => void; stop: () => void }
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

// Mock timers fire callbacks synchronously, so let promises settle between simulated intervals
async function advance(t: { mock: { timers: { tick: (ms: number) => void } } }, intervals: number, every = 1000) {
  for (let i = 0; i < intervals; i++) {
    t.mock.timers.tick(every)
    await flush()
  }
}

test('createPoller()', async (t) => {
  await t.test('runs a task on its interval', async () => {
    t.mock.timers.enable({ apis: ['setInterval'] })
    let runs = 0
    const poller = createPoller([{ run: () => void runs++, every: 1000 }])

    poller.start()
    await advance(t, 3)
    poller.stop()

    assert.equal(runs, 3)
    t.mock.timers.reset()
  })

  await t.test('does not run while shouldRun() is false', async () => {
    t.mock.timers.enable({ apis: ['setInterval'] })
    let runs = 0
    let active = false
    const poller = createPoller([{ run: () => void runs++, every: 1000 }], { shouldRun: () => active })

    poller.start()
    await advance(t, 2)
    assert.equal(runs, 0)

    active = true
    await advance(t, 1)
    assert.equal(runs, 1)

    poller.stop()
    t.mock.timers.reset()
  })

  await t.test('never overlaps runs of the same task', async () => {
    t.mock.timers.enable({ apis: ['setInterval'] })
    let runs = 0
    let finish: () => void = () => {}
    const poller = createPoller([
      {
        run: () =>
          new Promise<void>((resolve) => {
            runs++
            finish = resolve
          }),
        every: 1000
      }
    ])

    poller.start()
    await advance(t, 3) // the first run never finishes, so the next ticks are skipped
    assert.equal(runs, 1)

    finish()
    await flush()
    await advance(t, 1)
    assert.equal(runs, 2)

    poller.stop()
    t.mock.timers.reset()
  })

  await t.test('stop() halts polling and start() is idempotent', async () => {
    t.mock.timers.enable({ apis: ['setInterval'] })
    let runs = 0
    const poller = createPoller([{ run: () => void runs++, every: 1000 }])

    poller.start()
    poller.start()
    await advance(t, 1)
    assert.equal(runs, 1)

    poller.stop()
    await advance(t, 5)
    assert.equal(runs, 1)

    t.mock.timers.reset()
  })
})
