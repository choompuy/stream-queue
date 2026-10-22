import { test } from 'node:test'
import assert from 'node:assert/strict'
import { request, ApiError } from '../../public/js/http.js'

let seen = null
let reply = () => ({ ok: true, status: 200, json: async () => ({ data: {} }) })

globalThis.fetch = async (url, options = {}) => {
  seen = { url, options }
  return reply()
}

const answer = (status, body) => {
  reply = () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new SyntaxError('no body')
      return body
    }
  })
}

test('request', async (t) => {
  await t.test('gives the data of the reply', async () => {
    answer(200, { data: { a: 1 } })

    assert.deepEqual(await request('/api/x'), { a: 1 })
  })

  await t.test('gives null for a reply without data', async () => {
    answer(200, {})

    assert.equal(await request('/api/x'), null)
  })

  await t.test('a refusal is an ApiError with what the server said about it', async () => {
    answer(409, { error: 'raw text', code: 'DUPLICATE', params: { count: 2 } })

    await assert.rejects(request('/api/x'), (error) => {
      assert.ok(error instanceof ApiError)
      assert.deepEqual([error.message, error.status, error.code, error.params], ['raw text', 409, 'DUPLICATE', { count: 2 }])
      return true
    })
  })

  await t.test('a refusal without a body still says what failed', async () => {
    answer(502, undefined)

    await assert.rejects(request('/api/x'), (error) => error.message === 'Request failed: 502' && error.status === 502)
  })

  await t.test('a server that cannot be reached is a NETWORK_ERROR, with no status', async () => {
    reply = () => {
      throw new TypeError('fetch failed')
    }

    await assert.rejects(request('/api/x'), (error) => error.code === 'NETWORK_ERROR' && error.status === undefined && error.cause instanceof TypeError)
  })

  await t.test('a non-ok answer is a failure even when it carries data (an old server answering a refused save as an error)', async () => {
    answer(400, { code: 'INVALID_CONFIG', error: 'bad', data: { rejected: ['a'] } })

    await assert.rejects(request('/api/x'), (error) => error.code === 'INVALID_CONFIG')
  })

  await t.test('every request has a timeout, and a content type only when it has a body', async () => {
    answer(200, { data: {} })

    await request('/api/x')
    assert.ok(seen.options.signal instanceof AbortSignal)
    assert.equal(seen.options.headers['Content-Type'], undefined)

    await request('/api/x', { method: 'POST', body: '{}' })
    assert.equal(seen.options.headers['Content-Type'], 'application/json')
  })
})
