import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const { createEventStreams } = await import('../../src/sse.js')
const { emit } = await import('../../src/state-events.js')

type Stream = { status: number; headers: http.IncomingHttpHeaders; text: () => string; close: () => void; closed: Promise<void> }

async function startServer(options: Parameters<typeof createEventStreams>[0]) {
  const streams = createEventStreams(options)
  const app = express()
  app.get('/events', streams.handle)

  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port

  const opened: Stream[] = []

  function open(query = ''): Promise<Stream> {
    return new Promise((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path: `/events${query}` }, (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => (body += chunk))
        const closed = new Promise<void>((done) => res.on('close', () => done()))
        const stream: Stream = { status: res.statusCode ?? 0, headers: res.headers, text: () => body, close: () => req.destroy(), closed }
        opened.push(stream)
        resolve(stream)
      })
      req.on('error', (error) => {
        // destroying a stream on purpose is not an error of the test
        if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error)
      })
    })
  }

  return {
    streams,
    open,
    async stop() {
      opened.forEach((stream) => stream.close())
      streams.closeAll()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}

async function until(condition: () => boolean, what: string, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

const frames = (stream: Stream, name: string) => stream.text().split('\n\n').filter((frame) => frame.startsWith(`event: ${name}`))

test('GET /api/events', async (t) => {
  await t.test('the first frame sets the reconnect pause, and the answer is an event stream', async () => {
    const server = await startServer({ retryMs: 1234 })
    try {
      const stream = await server.open()

      await until(() => stream.text().includes('retry: 1234'), 'the retry frame')
      assert.equal(stream.status, 200)
      assert.match(String(stream.headers['content-type']), /text\/event-stream/)
      assert.match(String(stream.headers['cache-control']), /no-cache/)
      assert.equal(stream.headers['x-accel-buffering'], 'no')
      assert.ok(stream.text().startsWith('retry: 1234'))
    } finally {
      await server.stop()
    }
  })

  await t.test('a change arrives as a frame with its topic and a counter that grows per topic', async () => {
    const server = await startServer({ coalesceMs: 5 })
    try {
      const stream = await server.open()
      await until(() => stream.text().includes('retry:'), 'the connection')

      emit('state')
      await until(() => frames(stream, 'changed').length === 1, 'the first change')
      emit('state')
      await until(() => frames(stream, 'changed').length === 2, 'the second change')
      emit('activity')
      await until(() => frames(stream, 'changed').length === 3, 'a change of another topic')

      const data = frames(stream, 'changed').map((frame) => JSON.parse(frame.split('data: ')[1]))
      const [first, second, third] = data
      assert.equal(first.topic, 'state')
      assert.equal(second.topic, 'state')
      assert.equal(second.seq, first.seq + 1)
      assert.equal(third.topic, 'activity')
    } finally {
      await server.stop()
    }
  })

  await t.test('changes that follow each other within the window are one frame', async () => {
    const server = await startServer({ coalesceMs: 40 })
    try {
      const stream = await server.open()
      await until(() => stream.text().includes('retry:'), 'the connection')

      emit('state')
      emit('state')
      emit('state')
      await until(() => frames(stream, 'changed').length >= 1, 'the frame')
      await new Promise((resolve) => setTimeout(resolve, 120))

      assert.equal(frames(stream, 'changed').length, 1)
    } finally {
      await server.stop()
    }
  })

  await t.test('?topics= limits what a client hears, and unknown names are ignored', async () => {
    const server = await startServer({ coalesceMs: 5 })
    try {
      const onlyActivity = await server.open('?topics=activity')
      const nonsense = await server.open('?topics=nothing,real')
      await until(() => onlyActivity.text().includes('retry:') && nonsense.text().includes('retry:'), 'both connections')

      emit('state')
      emit('activity')
      await until(() => frames(onlyActivity, 'changed').length === 1 && frames(nonsense, 'changed').length === 2, 'the frames')

      assert.match(frames(onlyActivity, 'changed')[0], /"topic":"activity"/)
    } finally {
      await server.stop()
    }
  })

  await t.test('a quiet connection gets a ping event now and then', async () => {
    const server = await startServer({ pingEveryMs: 30 })
    try {
      const stream = await server.open()
      await until(() => frames(stream, 'ping').length >= 2, 'two pings')
    } finally {
      await server.stop()
    }
  })

  await t.test('a client that goes away frees its place, the one over the limit gets 503', async () => {
    const server = await startServer({ maxClients: 2 })
    try {
      const first = await server.open()
      await server.open()
      await until(() => server.streams.clientCount() === 2, 'two clients')

      const refused = await server.open()
      assert.equal(refused.status, 503)
      assert.equal(server.streams.clientCount(), 2)

      first.close()
      await until(() => server.streams.clientCount() === 1, 'the place to be freed')

      const accepted = await server.open()
      assert.equal(accepted.status, 200)
    } finally {
      await server.stop()
    }
  })

  await t.test('closeAll() ends every stream, so that server.close() does not wait for them', async () => {
    const server = await startServer({})
    try {
      const a = await server.open()
      const b = await server.open()
      await until(() => server.streams.clientCount() === 2, 'two clients')

      server.streams.closeAll()

      await Promise.all([a.closed, b.closed])
      assert.equal(server.streams.clientCount(), 0)
    } finally {
      await server.stop()
    }
  })
})
