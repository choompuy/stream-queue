import { test } from 'node:test'
import assert from 'node:assert/strict'

const { api, ApiError } = await import('../../../public/js/control/api.js')

const calls = []
let reply = null

globalThis.fetch = async (url, options = {}) => {
  calls.push({ url, method: options.method ?? 'GET' })
  if (reply instanceof Error) throw reply

  return {
    ok: reply.status < 400,
    status: reply.status,
    json: async () => {
      if (reply.body === undefined) throw new SyntaxError('Unexpected end of JSON input')
      return reply.body
    }
  }
}

const answer = (status, body) => {
  reply = { status, body }
}

const failure = async (action) => {
  try {
    await action()
  } catch (error) {
    return error
  }
  assert.fail('expected a rejection')
}

const refusedSave = { code: 'INVALID_CONFIG', params: { fields: 'maxQueueSize' }, data: { config: { minViews: 1 }, rejected: ['maxQueueSize'] } }

test('api', async (t) => {
  await t.test('a successful answer is its data, and nothing at all is null', async () => {
    answer(200, { data: { current: null } })
    assert.deepEqual(await api.getState(), { current: null })

    answer(200, undefined)
    assert.equal(await api.getState(), null)
  })

  await t.test('a refusal carries the status, the code and the parameters of the server', async () => {
    answer(404, { error: 'queue item not found', code: 'QUEUE_ITEM_NOT_FOUND', params: { a: 1 } })
    const error = await failure(() => api.removeFromQueue('abcdefghijk'))

    assert.ok(error instanceof ApiError)
    assert.equal(error.status, 404)
    assert.equal(error.code, 'QUEUE_ITEM_NOT_FOUND')
    assert.deepEqual(error.params, { a: 1 })
    assert.equal(error.message, 'queue item not found')
  })

  await t.test('an answer that is not JSON still becomes an error that names the status', async () => {
    answer(502, undefined)
    const error = await failure(() => api.getState())

    assert.equal(error.status, 502)
    assert.equal(error.message, 'Request failed: 502')
  })

  await t.test('a server that cannot be reached is NETWORK_ERROR, with the original error as the cause', async () => {
    reply = new TypeError('fetch failed')
    const error = await failure(() => api.getState())

    assert.equal(error.code, 'NETWORK_ERROR')
    assert.equal(error.cause, reply)
  })

  await t.test('a partial save is a result for the config endpoints: the stored config and the refused fields', async () => {
    answer(400, refusedSave)
    assert.deepEqual(await api.updateConfig({ maxQueueSize: 0 }), refusedSave.data)
    assert.deepEqual(await api.updateTwitchConfig({}), refusedSave.data)
  })

  await t.test('the same answer from any other endpoint is a failure', async () => {
    answer(400, refusedSave)
    const error = await failure(() => api.updateSettings({ opacity: 5 }))

    assert.equal(error.code, 'INVALID_CONFIG')
  })

  await t.test('ids are encoded into the path', async () => {
    answer(200, { data: {} })
    calls.length = 0
    await api.removeFromQueue('a/b c')

    assert.deepEqual(calls, [{ url: '/api/queue/video/a%2Fb%20c', method: 'DELETE' }])
  })
})
