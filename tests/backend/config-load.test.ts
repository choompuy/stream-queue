import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Files edited by hand (or left by an older version) are written BEFORE the modules are imported: they are read on first use
process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))
mkdirSync('data')

writeFileSync(
  'data/config.json',
  JSON.stringify({
    maxQueueSize: 'abc',
    minViews: -5,
    regionCode: 123,
    contentMode: 'everything',
    maxRequestsPerUser: 7,
    // a pair that contradicts itself is refused as a pair
    minDurationSeconds: 600,
    maxDurationSeconds: 30,
    fallbackPlaylist: { shuffle: 'yes', repeat: true },
    leftFromAnOlderVersion: 1
  })
)

writeFileSync(
  'data/secrets.json',
  JSON.stringify({
    youtubeApiKey: 42,
    twitch: { tokenData: { accessToken: 'only-half-a-token' }, userInfo: 'oops', connectedAt: 1700000000000 }
  })
)

const { getConfig } = await import('../../src/config.js')
const { getSecrets, getPublicSecretsView } = await import('../../src/secrets.js')

test('values read from a file go through the same rules as updates', async (t) => {
  await t.test('an invalid, unknown or contradicting value falls back to the default, the valid ones are kept', () => {
    const config = getConfig()

    assert.equal(config.maxQueueSize, 20)
    assert.equal(config.minViews, 10000)
    assert.equal(config.regionCode, '')
    assert.equal(config.contentMode, 'music')
    assert.equal(config.minDurationSeconds, 60)
    assert.equal(config.maxDurationSeconds, 480)
    assert.equal(config.fallbackPlaylist.shuffle, false)

    assert.equal(config.maxRequestsPerUser, 7)
    assert.equal(config.fallbackPlaylist.repeat, true)
    assert.equal('leftFromAnOlderVersion' in config, false)
  })

  await t.test('a damaged secrets file cannot break the code that reads it', () => {
    const secrets = getSecrets()

    assert.equal(secrets.youtubeApiKey, '')
    assert.equal(secrets.twitch.tokenData, null)
    assert.equal(secrets.twitch.userInfo, null)
    assert.equal(secrets.twitch.connectedAt, 1700000000000)

    assert.doesNotThrow(() => getPublicSecretsView())
  })
})
