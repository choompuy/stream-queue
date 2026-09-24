import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRateLimiter } from '../../src/rate-limit'

function run(limiter: ReturnType<typeof createRateLimiter>, ip: string) {
  const result = { status: 0, body: undefined as Record<string, any> | undefined, headers: {} as Record<string, string>, nextCalled: false }
  const req = { ip } as any
  const res = {
    set(name: string, value: string) {
      result.headers[name] = value
      return this
    },
    status(code: number) {
      result.status = code
      return this
    },
    json(body: Record<string, any>) {
      result.body = body
    }
  } as any
  const next = () => {
    result.nextCalled = true
  }

  limiter.middleware(req, res, next)
  return result
}

test('createRateLimiter()', async (t) => {
  await t.test('allows up to "max" requests per IP within the window', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3, keyPrefix: 'test' })

    for (let i = 0; i < 3; i++) assert.equal(run(limiter, '1.2.3.4').nextCalled, true, `request ${i + 1}`)

    const blocked = run(limiter, '1.2.3.4')
    assert.equal(blocked.nextCalled, false)
    assert.equal(blocked.status, 429)
    assert.equal(blocked.body?.code, 'RATE_LIMITED')
    assert.ok(blocked.headers['Retry-After'])
  })

  await t.test('tracks each IP independently', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, keyPrefix: 'test' })

    assert.equal(run(limiter, '1.1.1.1').nextCalled, true)
    assert.equal(run(limiter, '1.1.1.1').nextCalled, false)
    assert.equal(run(limiter, '2.2.2.2').nextCalled, true, 'a different IP has its own budget')
  })

  await t.test('two limiters with different keyPrefix do not share a budget for the same IP', () => {
    const a = createRateLimiter({ windowMs: 60_000, max: 1, keyPrefix: 'a' })
    const b = createRateLimiter({ windowMs: 60_000, max: 1, keyPrefix: 'b' })

    assert.equal(run(a, '1.1.1.1').nextCalled, true)
    assert.equal(run(b, '1.1.1.1').nextCalled, true, 'a different limiter is not exhausted by the other one')
  })

  await t.test('an old hit outside the window frees up a slot without needing an explicit reset', (t) => {
    t.mock.timers.enable({ apis: ['Date'] })
    const limiter = createRateLimiter({ windowMs: 1000, max: 1, keyPrefix: 'test' })

    assert.equal(run(limiter, '1.1.1.1').nextCalled, true)
    assert.equal(run(limiter, '1.1.1.1').nextCalled, false)

    t.mock.timers.tick(1001)
    assert.equal(run(limiter, '1.1.1.1').nextCalled, true)

    t.mock.timers.reset()
  })

  await t.test('requests with no IP (e.g. an odd proxy setup) share one bucket instead of throwing', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, keyPrefix: 'test' })

    assert.equal(run(limiter, undefined as unknown as string).nextCalled, true)
    assert.equal(run(limiter, undefined as unknown as string).nextCalled, false)
  })
})
