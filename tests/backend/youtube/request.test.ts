import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const { youtube, RequestNotSentError } = await import('../../../src/youtube/client.js')
const { updateSecrets } = await import('../../../src/secrets.js')
updateSecrets({ youtubeApiKey: 'test-key' })

const realFetch = globalThis.fetch
let calls = 0

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function stub(...answers: Array<Response | Error>): void {
  calls = 0
  globalThis.fetch = async () => {
    const answer = answers[Math.min(calls++, answers.length - 1)]
    if (answer instanceof Error) throw answer
    return answer
  }
}

test('youtube() requests', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })

  await t.test('a read is repeated after a 5xx and then succeeds', async () => {
    stub(json(503, {}), json(200, { items: ['ok'] }))
    assert.deepEqual(await youtube('videos', { id: 'x' }), { items: ['ok'] })
    assert.equal(calls, 2)
  })

  await t.test('with attempts: 1 nothing is repeated', async () => {
    stub(json(503, { error: { message: 'down' } }), json(200, {}))
    await assert.rejects(youtube('search', { q: 'x' }, { attempts: 1 }), /down/)
    assert.equal(calls, 1)
  })

  await t.test('a quota error is not repeated and is reported as the quota error', async () => {
    stub(json(403, { error: { message: 'q', errors: [{ reason: 'quotaExceeded' }] } }))
    await assert.rejects(youtube('videos', { id: 'x' }), (error: { code?: string }) => error.code === 'YOUTUBE_QUOTA')
    assert.equal(calls, 1)
  })

  await t.test('a network failure that never reached YouTube is marked as not sent', async () => {
    stub(new TypeError('fetch failed'))
    await assert.rejects(youtube('search', { q: 'x' }, { attempts: 1 }), (error: unknown) => error instanceof RequestNotSentError)
  })

  await t.test('a timeout is not marked as not sent: YouTube may have received the request', async () => {
    stub(new DOMException('timed out', 'TimeoutError'))
    await assert.rejects(youtube('search', { q: 'x' }, { attempts: 1 }), (error: unknown) => !(error instanceof RequestNotSentError))
  })

  await t.test('a missing key is marked as not sent and nothing goes out', async () => {
    updateSecrets({ youtubeApiKey: '' })
    stub(json(200, {}))
    await assert.rejects(youtube('videos', { id: 'x' }), (error: unknown) => error instanceof RequestNotSentError)
    assert.equal(calls, 0)
    updateSecrets({ youtubeApiKey: 'test-key' })
  })
})
