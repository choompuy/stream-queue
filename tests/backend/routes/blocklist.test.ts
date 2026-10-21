import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const express = (await import('express')).default
const { router } = await import('../../../src/routes/blocklist.js')
const { errorHandler } = await import('../../../src/error-handler.js')

const app = express()
app.use(express.json())
app.use('/api/blocklist', router)
app.use(errorHandler)

const server = app.listen(0)
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/blocklist`
after(() => server.close())

test('DELETE /api/blocklist/:videoId', async (t) => {
  await t.test('a malformed id is rejected by the shared param check, like the POST body is', async () => {
    const response = await fetch(`${base}/oops`, { method: 'DELETE' })

    assert.equal(response.status, 400)
    assert.equal(((await response.json()) as Record<string, any>).code, 'INVALID_VIDEO_ID')
  })

  await t.test('a well-formed id that is not blocked is a 404', async () => {
    const response = await fetch(`${base}/aaaaaaaaaaa`, { method: 'DELETE' })

    assert.equal(response.status, 404)
    assert.equal(((await response.json()) as Record<string, any>).code, 'NOT_FOUND')
  })
})
