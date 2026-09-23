import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { NextFunction, Request, Response } from 'express'
import { isLoopbackAddress, localOnly } from '../../src/local-only.js'

function run(remoteAddress: string | undefined) {
  const result = { nextCalled: false, status: 0, body: undefined as Record<string, any> | undefined }
  const req = { socket: { remoteAddress } } as unknown as Request
  const res = {
    status(code: number) {
      result.status = code
      return this
    },
    json(body: Record<string, any>) {
      result.body = body
    }
  } as unknown as Response
  const next: NextFunction = () => {
    result.nextCalled = true
  }

  localOnly(req, res, next)
  return result
}

test('isLoopbackAddress()', async (t) => {
  await t.test('recognises IPv4, IPv6 and IPv4-mapped loopback addresses', () => {
    for (const address of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1']) assert.equal(isLoopbackAddress(address), true, address)
  })

  await t.test('rejects everything else', () => {
    for (const address of ['192.168.1.20', '10.0.0.5', '::ffff:192.168.1.20', '8.8.8.8', '', undefined, '1127.0.0.1']) {
      assert.equal(isLoopbackAddress(address), false, String(address))
    }
  })
})

test('localOnly middleware', async (t) => {
  await t.test('lets a request from this machine through', () => {
    const result = run('127.0.0.1')

    assert.equal(result.nextCalled, true)
    assert.equal(result.status, 0)
  })

  await t.test('answers 403 LOCAL_ONLY to a device on the LAN and does not continue', () => {
    const result = run('192.168.1.20')

    assert.equal(result.nextCalled, false)
    assert.equal(result.status, 403)
    assert.equal(result.body?.code, 'LOCAL_ONLY')
  })

  await t.test('an unknown address is treated as not local', () => {
    assert.equal(run(undefined).nextCalled, false)
  })
})
