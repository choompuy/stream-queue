import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { errorHandler, ForbiddenOriginError } from './error-handler.js'

const app = express()
app.use(express.json({ limit: '1kb' }))
app.post('/echo', (req, res) => res.json({ got: req.body }))
app.get('/boom', () => {
  throw new Error('secret internal detail')
})
app.get('/origin', (_req, _res, next) => next(new ForbiddenOriginError()))
app.get('/teapot', (_req, _res, next) => next(Object.assign(new Error('teapot'), { status: 418 })))
app.get('/late', (_req, res, next) => {
  res.write('partial')
  next(new Error('after the headers were sent'))
})
app.use(errorHandler)

const server = app.listen(0)
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
after(() => server.close())

const post = (body: string) => fetch(`${base}/echo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })

test('errorHandler', async (t) => {
  await t.test('malformed JSON is a 400 INVALID_JSON, not a 500', async () => {
    const response = await post('{bad')
    const body = (await response.json()) as Record<string, any>

    assert.equal(response.status, 400)
    assert.equal(body.success, false)
    assert.equal(body.code, 'INVALID_JSON')
  })

  await t.test('a body over the limit is a 413 PAYLOAD_TOO_LARGE', async () => {
    const response = await post(JSON.stringify({ text: 'x'.repeat(5000) }))

    assert.equal(response.status, 413)
    assert.equal(((await response.json()) as Record<string, any>).code, 'PAYLOAD_TOO_LARGE')
  })

  await t.test('a request that is fine still works', async () => {
    const response = await post('{"a":1}')

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { got: { a: 1 } })
  })

  await t.test('a disallowed CORS origin is a 403 FORBIDDEN_ORIGIN', async () => {
    const response = await fetch(`${base}/origin`)

    assert.equal(response.status, 403)
    assert.equal(((await response.json()) as Record<string, any>).code, 'FORBIDDEN_ORIGIN')
  })

  await t.test('other client errors keep their 4xx status', async () => {
    const response = await fetch(`${base}/teapot`)

    assert.equal(response.status, 418)
    assert.equal(((await response.json()) as Record<string, any>).code, 'INVALID_REQUEST')
  })

  await t.test('a real failure is a 500 and does not leak its message', async (t) => {
    t.mock.method(console, 'log', () => {})
    const response = await fetch(`${base}/boom`)
    const text = await response.text()

    assert.equal(response.status, 500)
    assert.equal(JSON.parse(text).code, 'SERVER_ERROR')
    assert.equal(text.includes('secret internal detail'), false)
  })

  await t.test('an error after the response has started is left to Express instead of writing twice', async (t) => {
    t.mock.method(console, 'error', () => {})
    const response = await fetch(`${base}/late`).catch(() => null)

    // the connection is closed by Express; what matters is that the handler did not throw or send a second body
    if (response) assert.equal((await response.text().catch(() => '')).includes('SERVER_ERROR'), false)
  })
})
