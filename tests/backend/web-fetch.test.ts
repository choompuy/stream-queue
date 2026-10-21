import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchWithTimeout, retryableTransport } from '../../src/web-fetch.js'

// The transport is a thin skeleton, but its retry path has one job worth locking in: a thrown-away answer must
// not hold the connection (its body is cancelled), while the final answer comes back readable.
test('fetchWithTimeout: the retry path', async (t) => {
  const realFetch = globalThis.fetch

  await t.test('cancels the body of the retried answer and returns the final one readable', async () => {
    let cancelled = 0
    let calls = 0

    globalThis.fetch = (async () => {
      calls++
      if (calls === 1) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('rate limited'))
            // never closed on purpose: a body that waits to be read, like a real one
          }
        })
        const response = new Response(body, { status: 429 })
        const cancel = response.body!.cancel.bind(response.body)
        response.body!.cancel = () => {
          cancelled++
          return cancel()
        }
        return response
      }
      return new Response('ok', { status: 200 })
    }) as typeof fetch

    try {
      const response = await fetchWithTimeout(
        'https://example.test/flaky',
        undefined,
        1000,
        { attempts: 2, delayMs: () => 0, shouldRetry: retryableTransport }
      )

      assert.equal(response.status, 200)
      assert.equal(await response.text(), 'ok', 'the final answer is returned with a readable body')
      assert.equal(cancelled, 1, 'only the thrown-away answer has its body cancelled')
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
