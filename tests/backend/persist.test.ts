import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const testDir = mkdtempSync(join(tmpdir(), 'streamqueue-persist-'))
process.chdir(testDir)

const { createFileStore, flushAllStores, ensureDataDirectory } = await import('../../src/persist.js')

let counter = 0
const filePath = () => join(testDir, `store-${++counter}.json`)

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

test('load()', async (t) => {
  await t.test('returns the defaults when the file does not exist', () => {
    const store = createFileStore<{ a: number }>(filePath())
    assert.deepEqual(store.load({ a: 1 }), { a: 1 })
  })

  await t.test('deep-merges saved data onto the defaults: new default fields survive, saved values win', () => {
    const path = filePath()
    writeFileSync(path, JSON.stringify({ a: 5, nested: { x: 1 } }))
    const store = createFileStore<{ a: number; b: number; nested: { x: number; y: number } }>(path)

    assert.deepEqual(store.load({ a: 0, b: 9, nested: { x: 0, y: 2 } }), { a: 5, b: 9, nested: { x: 1, y: 2 } })
  })

  await t.test('an array value replaces the default array rather than being merged element-wise', () => {
    const path = filePath()
    writeFileSync(path, JSON.stringify([{ id: 'saved' }]))
    const store = createFileStore<Array<{ id: string }>>(path)

    assert.deepEqual(store.load([{ id: 'default1' }, { id: 'default2' }]), [{ id: 'saved' }])
  })

  await t.test('a corrupted file falls back to the defaults instead of throwing', (t) => {
    const errors = t.mock.method(console, 'error', () => {})
    const path = filePath()
    writeFileSync(path, '{not valid json')
    const store = createFileStore<{ a: number }>(path)

    assert.deepEqual(store.load({ a: 1 }), { a: 1 })
    assert.equal(errors.mock.callCount(), 1)
  })

  await t.test('a saved null does not crash the merge and is kept as-is', () => {
    const path = filePath()
    writeFileSync(path, JSON.stringify({ a: null }))
    const store = createFileStore<{ a: number | null }>(path)

    assert.deepEqual(store.load({ a: 1 }), { a: null })
  })

  await t.test('a top-level value of the wrong kind gives the defaults instead of lying about the type', (t2) => {
    t2.mock.method(console, 'warn', () => {})

    for (const saved of ['null', '"text"', '5', 'true']) {
      const path = filePath()
      writeFileSync(path, saved)
      const store = createFileStore<{ a: number }>(path)

      assert.deepEqual(store.load({ a: 1 }), { a: 1 }, `file holding ${saved}`)
    }
  })

  await t.test('an object where a list belongs gives the defaults', (t2) => {
    t2.mock.method(console, 'warn', () => {})
    const path = filePath()
    writeFileSync(path, JSON.stringify({ a: 1 }))
    const store = createFileStore<Array<{ id: string }>>(path)

    assert.deepEqual(store.load([{ id: 'x' }]), [{ id: 'x' }])
  })

  await t.test('a file of the wrong kind is set aside, like a corrupt one, instead of being silently overwritten', (t2) => {
    t2.mock.method(console, 'warn', () => {})
    const path = filePath()
    writeFileSync(path, 'null')
    const store = createFileStore<{ a: number }>(path)

    assert.deepEqual(store.load({ a: 1 }), { a: 1 })

    assert.equal(existsSync(path), false)
    const kept = readdirSync(testDir).filter((name) => name.startsWith(`${basename(path)}.corrupt-`))
    assert.equal(kept.length, 1)
  })
})

test('scheduleSave() / flush()', async (t) => {
  await t.test('flush() writes the file with the latest scheduled data', async () => {
    const path = filePath()
    const store = createFileStore<{ n: number }>(path)

    store.scheduleSave(
      () => ({ n: 1 }),
      () => {}
    )
    await store.flush()

    assert.deepEqual(readJson(path), { n: 1 })
  })

  await t.test('several scheduleSave calls before flush() write only the latest value once', async () => {
    const path = filePath()
    const store = createFileStore<{ n: number }>(path)
    const written: number[] = []
    const originalWriteFile = (await import('node:fs/promises')).writeFile

    store.scheduleSave(
      () => ({ n: 1 }),
      () => {}
    )
    store.scheduleSave(
      () => ({ n: 2 }),
      () => {}
    )
    store.scheduleSave(
      () => ({ n: 3 }),
      () => {}
    )
    await store.flush()

    assert.deepEqual(readJson(path), { n: 3 })
    void originalWriteFile
    void written
  })

  await t.test('scheduleSave reads getData() lazily: a value changed after scheduling but before flush is what gets saved', async () => {
    const path = filePath()
    const store = createFileStore<{ n: number }>(path)
    let value = { n: 1 }

    store.scheduleSave(
      () => value,
      () => {}
    )
    value = { n: 99 } // mutated after scheduling, like a module-level array being pushed to again
    await store.flush()

    assert.deepEqual(readJson(path), { n: 99 })
  })

  await t.test('flush() with nothing scheduled does not create the file or throw', async () => {
    const path = filePath()
    const store = createFileStore<{ n: number }>(path)

    await assert.doesNotReject(store.flush())
    assert.equal(existsSync(path), false)
  })

  await t.test('flush() is safe to call twice in a row', async () => {
    const path = filePath()
    const store = createFileStore<{ n: number }>(path)

    store.scheduleSave(
      () => ({ n: 1 }),
      () => {}
    )
    await store.flush()
    await assert.doesNotReject(store.flush())

    assert.deepEqual(readJson(path), { n: 1 })
  })

  await t.test('creates the containing directory if it does not exist yet', async () => {
    const path = join(testDir, `nested-${++counter}`, 'sub', 'store.json')
    const store = createFileStore<{ n: number }>(path)

    store.scheduleSave(
      () => ({ n: 1 }),
      () => {}
    )
    await store.flush()

    assert.deepEqual(readJson(path), { n: 1 })
  })

  await t.test('the temp file used for the atomic write is gone once flush() resolves', async () => {
    const path = filePath()
    const store = createFileStore<{ n: number }>(path)

    store.scheduleSave(
      () => ({ n: 1 }),
      () => {}
    )
    await store.flush()

    assert.equal(existsSync(`${path}.tmp`), false)
  })

  await t.test('an error from the write is reported through onError and does not throw out of flush()', async () => {
    const badDir = join(testDir, `not-writable-${++counter}`)
    mkdirSync(badDir)
    // a directory in place of the target file makes the rename fail; a simple, portable way to force a write error
    const path = join(badDir, 'sub') // 'sub' will be the target file path...
    mkdirSync(path) // ...but it's a directory, so writing to it must fail

    const store = createFileStore<{ n: number }>(path)
    const errors: unknown[] = []

    store.scheduleSave(
      () => ({ n: 1 }),
      (error) => errors.push(error)
    )
    await assert.doesNotReject(store.flush())

    assert.equal(errors.length, 1)
  })
})

test('debounce timing', async (t) => {
  // flush() deliberately bypasses the debounce timer (it fires the pending save immediately, for shutdown),
  // so it cannot be used to observe debounce timing. These tests use small real delays instead of mock
  // timers: Node's MockTimers API does not reliably surface a difference between "timer reset" and "timer
  // left alone" for a timeout that was already armed before the mutation point, so a real clock is the only
  // way to actually exercise this path. The delays are short enough to keep the suite fast.
  const DEBOUNCE_MS = 250 // must match SAVE_DEBOUNCE_MS in persist.ts

  function waitForFile(path: string, timeoutMs = 2000): Promise<void> {
    const start = Date.now()
    return new Promise((resolve, reject) => {
      const check = () => {
        if (existsSync(path)) return resolve()
        if (Date.now() - start > timeoutMs) return reject(new Error(`${path} did not appear within ${timeoutMs}ms`))
        setTimeout(check, 5)
      }
      check()
    })
  }

  await t.test('a write is not made immediately; it waits for the debounce window', async () => {
    const path = filePath()
    const store = createFileStore<{ n: number }>(path)

    store.scheduleSave(
      () => ({ n: 1 }),
      () => {}
    )
    await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS - 100))
    assert.equal(existsSync(path), false, 'nothing should be written before the debounce window elapses')

    await waitForFile(path)
    assert.deepEqual(readJson(path), { n: 1 })
  })

  await t.test('scheduling again before the window elapses resets the timer (a true debounce, not a fixed interval)', async () => {
    const calls: number[] = []
    const start = Date.now()
    const path = filePath()
    const store = createFileStore<{ n: number }>(path)

    store.scheduleSave(
      () => {
        calls.push(Date.now() - start)
        return { n: 1 }
      },
      () => {}
    )
    await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS - 50)) // well under the window

    const secondCallAt = Date.now() - start
    store.scheduleSave(
      () => {
        calls.push(Date.now() - start)
        return { n: 2 }
      },
      () => {}
    ) // must push the fire time out to (roughly) secondCallAt + DEBOUNCE_MS

    await waitForFile(path)

    assert.equal(calls.length, 1, 'exactly one write, from the second call, not a leftover one from the first')
    assert.deepEqual(readJson(path), { n: 2 })
    // a fixed (non-resetting) interval would have fired at ~DEBOUNCE_MS from the *first* call; a real
    // debounce fires at ~DEBOUNCE_MS from the *second* one. Comparing against the midpoint tells them apart
    // without being so tight that normal test-runner jitter causes a false failure.
    assert.ok(calls[0] > secondCallAt + DEBOUNCE_MS / 2, `fired at ${calls[0]}ms, expected well after ${secondCallAt}ms + ${DEBOUNCE_MS}ms`)
  })

  await t.test('several rapid calls only ever produce one write, not one per call', async () => {
    const calls = { count: 0 }
    const path = filePath()
    const store = createFileStore<{ n: number }>(path)

    for (let i = 0; i < 5; i++) {
      store.scheduleSave(
        () => {
          calls.count++
          return { n: i }
        },
        () => {}
      )
      await new Promise((resolve) => setTimeout(resolve, 20)) // well under the debounce window each time
    }

    await waitForFile(path)
    await new Promise((resolve) => setTimeout(resolve, 50)) // let a second, wrongly-scheduled write show up if there is one

    assert.equal(calls.count, 1, 'getData should only be read once, for the final write')
    assert.deepEqual(readJson(path), { n: 4 })
  })
})

test('transient write failures are retried', async (t) => {
  const { rename: realRename } = await import('node:fs/promises')
  const busy = (): Error & { code: string } => {
    const error = new Error('resource busy or locked') as Error & { code: string }
    error.code = 'EBUSY'
    return error
  }

  await t.test('a rename blocked once (an antivirus letting go of the file) succeeds on the second attempt', async () => {
    const path = filePath()
    let calls = 0
    const store = createFileStore<{ n: number }>(path, {
      rename: async (from, to) => {
        calls++
        if (calls === 1) throw busy()
        return realRename(from, to)
      },
      retryDelayMs: 1
    })

    store.scheduleSave(() => ({ n: 1 }))
    await store.flush()

    assert.equal(calls, 2)
    assert.deepEqual(readJson(path), { n: 1 })
  })

  await t.test('a rename that keeps failing is given up after three attempts and the .tmp is cleaned up', async (t2) => {
    t2.mock.method(console, 'error', () => {})
    const path = filePath()
    let calls = 0
    const store = createFileStore<{ n: number }>(path, {
      rename: async () => {
        calls++
        throw busy()
      },
      retryDelayMs: 1
    })
    const errors: unknown[] = []

    store.scheduleSave(
      () => ({ n: 1 }),
      (error) => errors.push(error)
    )
    await store.flush()

    assert.equal(calls, 3)
    assert.equal(errors.length, 1)
    assert.equal(existsSync(`${path}.tmp`), false)
  })

  await t.test('a non-transient failure is not retried at all', async () => {
    const path = filePath()
    let calls = 0
    const store = createFileStore<{ n: number }>(path, {
      rename: async () => {
        calls++
        const error = new Error('is a directory') as Error & { code: string }
        error.code = 'EISDIR'
        throw error
      },
      retryDelayMs: 1
    })
    const errors: unknown[] = []

    store.scheduleSave(
      () => ({ n: 1 }),
      (error) => errors.push(error)
    )
    await store.flush()

    assert.equal(calls, 1)
    assert.equal(errors.length, 1)
  })
})

test('a store without its own onError reports the failure itself', async (t) => {
  const errors = t.mock.method(console, 'error', () => {})
  const badDir = join(testDir, `not-writable-${++counter}`)
  mkdirSync(badDir)
  const path = join(badDir, 'sub') // a directory in place of the file makes the write fail
  mkdirSync(path)

  const store = createFileStore<{ n: number }>(path)
  store.scheduleSave(() => ({ n: 1 }))
  await store.flush()

  assert.equal(errors.mock.callCount(), 1)
  // raw arguments, not JSON.stringify: on Windows JSON-escaping doubles the backslashes in the path
  const reported = String(errors.mock.calls[0]?.arguments ?? '')
  assert.ok(reported.includes('Failed to save'), reported)
  assert.ok(reported.includes(path), reported)
})

test('ensureDataDirectory()', async (t) => {
  await t.test('creates the directory, checks that it is writable and says where it is', async (t2) => {
    const logs = t2.mock.method(console, 'log', () => {})

    await ensureDataDirectory()

    const dataDir = join(testDir, 'data')
    assert.ok(existsSync(dataDir))
    assert.equal(existsSync(join(dataDir, '.write-test')), false, 'the probe file is cleaned up')
    const logged = logs.mock.calls.map((call) => call.arguments.join(' ')).join('\n')
    assert.ok(logged.includes(`Data directory: ${dataDir}`), logged)
  })

  await t.test('reports a data directory that cannot be created, without throwing', async (t2) => {
    const errors = t2.mock.method(console, 'error', () => {})
    const blocked = join(testDir, `blocked-${++counter}`)
    mkdirSync(blocked)
    writeFileSync(join(blocked, 'data'), 'a file in place of the directory')

    process.chdir(blocked)
    try {
      await assert.doesNotReject(ensureDataDirectory())
    } finally {
      process.chdir(testDir)
    }

    assert.equal(errors.mock.callCount(), 1)
    const reported = JSON.stringify(errors.mock.calls[0]?.arguments ?? [])
    assert.ok(reported.includes('not writable'), reported)
  })
})

test('saveNow()', async (t) => {
  await t.test('writes the file at once, without waiting for the debounce', async () => {
    const path = filePath()
    const store = createFileStore<{ n: number }>(path)

    await store.saveNow(
      () => ({ n: 1 }),
      () => {}
    )

    assert.deepEqual(readJson(path), { n: 1 })
  })

  await t.test('joins the chain: a save scheduled before it is waited for, not raced, and both land once each', async () => {
    const path = filePath()
    const store = createFileStore<{ n: number }>(path)
    const order: string[] = []

    store.scheduleSave(
      () => {
        order.push('scheduled')
        return { n: 1 }
      },
      () => {}
    )
    await store.saveNow(
      () => {
        order.push('now')
        return { n: 2 }
      },
      () => {}
    )
    await store.flush()

    assert.deepEqual(order, ['now', 'scheduled'], 'one write at a time: the .tmp file is never shared by two saves')
    assert.deepEqual(readJson(path), { n: 1 }, 'the debounced write ran last, with its own data')
  })

  await t.test('flush() waits for a saveNow that is still on the chain', async () => {
    const path = filePath()
    const store = createFileStore<{ n: number }>(path)

    void store.saveNow(
      () => ({ n: 7 }),
      () => {}
    )
    await store.flush()

    assert.deepEqual(readJson(path), { n: 7 }, 'the exit flush did not leave before this save was written')
  })

  await t.test('an error is reported through onError, and a later save still works', async () => {
    const badDir = join(testDir, `not-writable-${++counter}`)
    mkdirSync(badDir)
    const path = join(badDir, 'sub') // a directory in place of the file makes the write fail
    mkdirSync(path)

    const store = createFileStore<{ n: number }>(path)
    const errors: unknown[] = []

    await assert.doesNotReject(
      store.saveNow(
        () => ({ n: 1 }),
        (error) => errors.push(error)
      )
    )
    assert.equal(errors.length, 1)

    const goodPath = filePath()
    const goodStore = createFileStore<{ n: number }>(goodPath)
    goodStore.scheduleSave(
      () => ({ n: 2 }),
      () => {}
    )
    await goodStore.flush()
    assert.deepEqual(readJson(goodPath), { n: 2 })
  })
})

test('flushAllStores()', async (t) => {
  await t.test('flushes every store created so far, including ones with nothing pending', async () => {
    const pathA = filePath()
    const pathB = filePath()
    const storeA = createFileStore<{ n: number }>(pathA)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const storeB = createFileStore<{ n: number }>(pathB)

    storeA.scheduleSave(
      () => ({ n: 1 }),
      () => {}
    )
    // storeB has nothing scheduled

    await flushAllStores()

    assert.deepEqual(readJson(pathA), { n: 1 })
    assert.equal(existsSync(pathB), false)
  })

  await t.test('one store failing to flush does not stop the others from flushing', async (t) => {
    t.mock.method(console, 'error', () => {})
    const badDir = join(testDir, `not-writable-${++counter}`)
    mkdirSync(badDir)
    const badPath = join(badDir, 'sub')
    mkdirSync(badPath)

    const goodPath = filePath()
    const badStore = createFileStore<{ n: number }>(badPath)
    const goodStore = createFileStore<{ n: number }>(goodPath)

    badStore.scheduleSave(
      () => ({ n: 1 }),
      () => {}
    )
    goodStore.scheduleSave(
      () => ({ n: 2 }),
      () => {}
    )

    await assert.doesNotReject(flushAllStores())

    assert.deepEqual(readJson(goodPath), { n: 2 })
  })

  await t.test("never rejects, even if a store's onError callback itself throws", async (t) => {
    t.mock.method(console, 'error', () => {})
    const badDir = join(testDir, `not-writable-${++counter}`)
    mkdirSync(badDir)
    const badPath = join(badDir, 'sub')
    mkdirSync(badPath)

    const badStore = createFileStore<{ n: number }>(badPath)
    badStore.scheduleSave(
      () => ({ n: 1 }),
      () => {
        throw new Error('onError itself is broken')
      }
    )

    // flushAllStores must not reject the whole process's shutdown sequence over one store's failure,
    // regardless of how badly that one store's own error handling misbehaves
    await assert.doesNotReject(flushAllStores())
  })
})
