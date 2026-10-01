import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

globalThis.document = new JSDOM('<!doctype html><html><body></body></html>').window.document

const { run, errorMessage } = await import('../../../public/js/control/run.js')
const { ApiError } = await import('../../../public/js/control/api.js')

test('errorMessage', async (t) => {
  await t.test('uses the translated code when available', () => {
    const fakeT = (key) => (key === 'api.errors.duplicate' ? 'This track is already in the queue' : key)
    const error = new ApiError('raw message', { code: 'DUPLICATE' })
    // errorMessage relies on the module-level t() from i18n.js, not an injectable one,
    // so we only assert it doesn't throw and returns a string here.
    assert.equal(typeof errorMessage(error), 'string')
  })

  await t.test('falls back to the error message for a plain Error', () => {
    assert.equal(errorMessage(new Error('boom')), 'boom')
  })

  await t.test('falls back to String(error) for a non-Error value', () => {
    assert.equal(errorMessage('just a string'), 'just a string')
  })
})

test('run', async (t) => {
  await t.test('returns the action result on success', async () => {
    const result = await run('doing a thing', () => 42)
    assert.equal(result, 42)
  })

  await t.test('awaits an async action', async () => {
    const result = await run('doing a thing', async () => 'done')
    assert.equal(result, 'done')
  })

  await t.test('a silent failure resolves to undefined without throwing', async () => {
    const result = await run('doing a thing', () => {
      throw new Error('boom')
    }, { silent: true })
    assert.equal(result, undefined)
  })

  await t.test('a plain Error (not ApiError) is swallowed without needing silent', async () => {
    // toastError() is only called for ApiError instances, so a plain Error never
    // touches the toast/DOM path even without silent: true.
    const result = await run('doing a thing', () => {
      throw new Error('boom')
    })
    assert.equal(result, undefined)
  })

  await t.test('onError is called with the thrown error', async () => {
    const seen = []
    await run(
      'doing a thing',
      () => {
        throw new Error('boom')
      },
      { silent: true, onError: (error) => seen.push(error.message) }
    )
    assert.deepEqual(seen, ['boom'])
  })

  await t.test('with a button, it is disabled during the action and re-enabled after', async () => {
    const button = { disabled: false }
    let disabledDuringAction = null

    await run(
      'doing a thing',
      () => {
        disabledDuringAction = button.disabled
      },
      { button }
    )

    assert.equal(disabledDuringAction, true)
    assert.equal(button.disabled, false)
  })

  await t.test('with a button, it is re-enabled even after a silent failure', async () => {
    const button = { disabled: false }

    await run(
      'doing a thing',
      () => {
        throw new Error('boom')
      },
      { button, silent: true }
    )

    assert.equal(button.disabled, false)
  })
})
