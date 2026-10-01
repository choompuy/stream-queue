import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// no updateSecrets() call anywhere in this file - the whole point is a key that was never set. It has to
// live in its own file: Node runs each test file with a separate module registry, and updateSecrets() never
// accepts an empty value, so once any *other* file in the suite sets a key on the shared secrets.js
// instance, there is no way back to "no key" from within that same process.
process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const { searchSongs } = await import('../../../src/youtube/index.js')
const { canSearch } = await import('../../../src/youtube/cache.js')

test('a missing API key never attempts a request and does not consume a search from the daily quota', async () => {
  const realFetch = globalThis.fetch
  let fetchCalled = false
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input))
    if (url.hostname === 'www.googleapis.com') fetchCalled = true
    return realFetch(input, init)
  }

  await assert.rejects(searchSongs('some query'), { code: 'NO_API_KEY' })

  assert.equal(fetchCalled, false, 'no request should have been sent to YouTube at all')
  assert.equal(canSearch(), true)
})
