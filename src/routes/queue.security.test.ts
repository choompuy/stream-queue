import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const express = (await import('express')).default
const { router } = await import('./queue.js')
const { router: searchRouter } = await import('./search.js')
const { updateConfig } = await import('../config.js')
const { updateSecrets } = await import('../secrets.js')
const queue = await import('../queue.js')

updateSecrets({ youtubeApiKey: 'test-key' })
// a filter no unfiltered video can pass, so any accepted result proves the filter was skipped
updateConfig({ minViews: 999_999_999 })

// stubbed YouTube: one search hit and one lookup-by-id, both far below the view threshold above
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input instanceof Request ? input.url : input))
  if (url.hostname !== 'www.googleapis.com') return realFetch(input, init)

  const respond = (items: unknown[]) => new Response(JSON.stringify({ items }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  const videoItem = (id: string) => ({
    id,
    snippet: { title: `Song ${id}`, channelTitle: 'Channel', thumbnails: { medium: { url: 'https://img/x.jpg' } } },
    contentDetails: { duration: 'PT3M' },
    statistics: { viewCount: '10' }
  })

  if (url.pathname.endsWith('/search')) return respond([{ id: { videoId: 'aaaaaaaaaaa' }, snippet: videoItem('aaaaaaaaaaa').snippet }])
  return respond([videoItem(url.searchParams.get('id') ?? 'aaaaaaaaaaa')])
}

// a fake socket.remoteAddress, since supertest/fetch-in-process both report 127.0.0.1 for every request
function appWithRemoteAddress(remoteAddress: string) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    Object.defineProperty(req.socket, 'remoteAddress', { value: remoteAddress, configurable: true })
    next()
  })
  app.use('/api/queue', router)
  app.use('/api/search', searchRouter)
  return app
}

async function withServer(remoteAddress: string, run: (base: string) => Promise<void>) {
  const server = appWithRemoteAddress(remoteAddress).listen(0)
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api`)
  } finally {
    server.close()
  }
}

beforeEach(() => {
  queue.clearQueue()
  queue.setCurrent(null)
})

test('"admin" filter bypass', async (t) => {
  await t.test('POST /api/queue/request: admin=true from a LAN address does not bypass filters', async () => {
    await withServer('192.168.1.50', async (base) => {
      const response = await fetch(`${base}/queue/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', requestedBy: 'stranger', admin: true })
      })

      // any rejection proves the bypass did not apply; a category or view-count filter, whichever runs first
      assert.equal(response.status, 404, 'a filtered-out video should be rejected as if admin had no effect')
    })
  })

  await t.test('POST /api/queue/request: admin=true from the local machine still bypasses filters', async () => {
    await withServer('127.0.0.1', async (base) => {
      const response = await fetch(`${base}/queue/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', requestedBy: 'ControlPanel', admin: true })
      })

      assert.equal(response.status, 201)
    })
  })

  await t.test('GET /api/search: admin=1 from a LAN address does not bypass filters', async () => {
    await withServer('10.0.0.7', async (base) => {
      const response = await fetch(`${base}/search?q=some+song&admin=1`)
      const body = (await response.json()) as Record<string, any>

      assert.equal(response.status, 200)
      assert.deepEqual(body.data.results, [])
    })
  })

  await t.test('GET /api/search: admin=1 from the local machine bypasses filters', async () => {
    await withServer('::1', async (base) => {
      const response = await fetch(`${base}/search?q=some+song&admin=1`)
      const body = (await response.json()) as Record<string, any>

      assert.equal(response.status, 200)
      assert.equal(body.data.results.length, 1)
    })
  })
})

test('rate limiting', async (t) => {
  await t.test('POST /api/queue/request: the 11th request in a minute from one address is 429', async () => {
    await withServer('203.0.113.5', async (base) => {
      let last: Response | undefined
      for (let i = 0; i < 11; i++) {
        last = await fetch(`${base}/queue/request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: `https://www.youtube.com/watch?v=aaaaaaaaaaa`, requestedBy: `viewer${i}` })
        })
      }

      assert.equal(last?.status, 429)
      const body = (await last!.json()) as Record<string, any>
      assert.equal(body.code, 'RATE_LIMITED')
      assert.ok(last?.headers.get('Retry-After'))
    })
  })

  await t.test('POST /api/queue/request: a different address is not affected by another one being limited', async () => {
    await withServer('203.0.113.6', async (base) => {
      for (let i = 0; i < 10; i++) {
        await fetch(`${base}/queue/request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: `https://www.youtube.com/watch?v=aaaaaaaaaaa`, requestedBy: `viewer${i}` })
        })
      }
    })

    await withServer('203.0.113.7', async (base) => {
      const response = await fetch(`${base}/queue/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: `https://www.youtube.com/watch?v=aaaaaaaaaaa`, requestedBy: 'viewerX' })
      })

      assert.notEqual(response.status, 429)
    })
  })

  await t.test('GET /api/search: the 31st search in a minute from one address is 429', async () => {
    await withServer('203.0.113.8', async (base) => {
      let last: Response | undefined
      for (let i = 0; i < 31; i++) last = await fetch(`${base}/search?q=song${i}`)

      assert.equal(last?.status, 429)
    })
  })
})
