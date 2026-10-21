import { test } from 'node:test'
import assert from 'node:assert/strict'

// A listening net.Server shows up here, so "the app did not start" can be asserted, not just assumed
function tcpListenerCount(): number {
  return process.getActiveResourcesInfo().filter((name) => name === 'TCPServerWrap').length
}

test('createApp assembles the app without starting it', async (t) => {
  // dynamic import on purpose: it happens after the baseline, so import-time side effects are caught too
  const before = tcpListenerCount()
  const { createApp, listenOnFreePort } = await import('../../src/app.js')

  await t.test('importing the module and building the app opens no listener', () => {
    const app = createApp()

    assert.equal(typeof app, 'function', 'an express app is a callable')
    assert.equal(typeof app.listen, 'function', 'listen() is exposed, not called')
    assert.equal(tcpListenerCount(), before, 'building the app must not start a server')
  })

  await t.test('a real listener is visible to the same check', async () => {
    const app = createApp()
    // port 0 = an ephemeral port picked by the OS, nothing to collide with
    const { server } = await listenOnFreePort(app, 0)

    assert.ok(tcpListenerCount() > before, 'the check above would be vacuous otherwise')

    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
})
