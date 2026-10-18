import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { errorHandler } from '../../src/error-handler.js'
import { AppError } from '../../src/types.js'
import { describeError } from '../../src/logger.js'

const app = express()
app.use(express.json({ limit: '1kb' }))
app.post('/echo', (req, res) => res.json({ got: req.body }))
app.get('/boom', () => {
  throw new Error('secret internal detail')
})
app.get('/teapot', (_req, _res, next) => next(Object.assign(new Error('teapot'), { status: 418 })))
app.get('/late', (_req, res, next) => {
  res.write('partial')
  next(new Error('after the headers were sent'))
})
app.get('/refused', () => {
  throw new AppError('DUPLICATE', 'this track is already in the queue')
})
app.get('/twitch', () => {
  throw new AppError('TWITCH_API_ERROR', 'title must be unique', { status: 400 })
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

  await t.test('a thrown AppError answers with its own code, status and parameters', async () => {
    const response = await fetch(`${base}/refused`)
    const body = (await response.json()) as Record<string, any>

    assert.equal(response.status, 409)
    assert.equal(body.success, false)
    assert.equal(body.code, 'DUPLICATE')
    assert.equal(body.params.message, 'this track is already in the queue')
  })

  await t.test('a thrown Twitch API error carries the message Twitch returned', async () => {
    const response = await fetch(`${base}/twitch`)
    const body = (await response.json()) as Record<string, any>

    assert.equal(response.status, 502)
    assert.equal(body.code, 'TWITCH_API_ERROR')
    assert.ok(body.error.includes('title must be unique'))
  })

  await t.test('describeError says which error it was, not only its message', () => {
    assert.equal(describeError(new AppError('USER_LIMIT', 'you can only queue 2 track(s) at a time', { count: 2 })), 'AppError USER_LIMIT: you can only queue 2 track(s) at a time {"count":2}')
    assert.equal(describeError(new TypeError('fetch failed')), 'TypeError: fetch failed')
    assert.equal(describeError(new Error('a plain one')), 'a plain one')
    assert.equal(describeError('not even an error'), 'not even an error')
  })

  await t.test('an error after the response has started is left to Express instead of writing twice', async (t) => {
    t.mock.method(console, 'error', () => {})
    const response = await fetch(`${base}/late`).catch(() => null)

    // the connection is closed by Express; what matters is that the handler did not throw or send a second body
    if (response) assert.equal((await response.text().catch(() => '')).includes('SERVER_ERROR'), false)
  })
})
