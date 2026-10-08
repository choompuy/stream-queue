import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const { CACHE_LIMITS, getSearchCache, setSearchCache, getVideoCache, setVideoCache, reserveSearchQuota, releaseSearchQuota, getSearchesToday } =
  await import('../../../src/youtube/cache.js')

const song = {
  videoId: 'video-1',
  title: 'Test song',
  channelTitle: 'Test channel'
} as any

const videoResult = {
  song,
  reason: null
}

beforeEach(() => {
  // The cache module keeps its Maps between tests, so use unique keys.
})

test('search cache stores and returns songs', () => {
  const key = `search-${Date.now()}-1`
  setSearchCache(key, [song])
  assert.deepEqual(getSearchCache(key), [song])
})

test('search cache returns undefined for a missing key', () => {
  assert.equal(getSearchCache(`missing-${Date.now()}`), undefined)
})

test('video cache stores and returns result', () => {
  const key = `video-${Date.now()}-1`
  setVideoCache(key, videoResult)
  assert.deepEqual(getVideoCache(key), videoResult)
})

test('video cache returns undefined for a missing key', () => {
  assert.equal(getVideoCache(`missing-${Date.now()}`), undefined)
})

test('search cache expires after its TTL', async () => {
  const key = `search-expiry-${Date.now()}`
  setSearchCache(key, [song])
  assert.deepEqual(getSearchCache(key), [song])
  const realNow = Date.now
  Date.now = () => realNow() + CACHE_LIMITS.SEARCH_CACHE_TTL + 1

  try {
    assert.equal(getSearchCache(key), undefined)
  } finally {
    Date.now = realNow
  }
})

test('video cache expires after its TTL', () => {
  const key = `video-expiry-${Date.now()}`
  setVideoCache(key, videoResult)
  assert.deepEqual(getVideoCache(key), videoResult)
  const realNow = Date.now
  Date.now = () => realNow() + CACHE_LIMITS.VIDEO_CACHE_TTL + 1

  try {
    assert.equal(getVideoCache(key), undefined)
  } finally {
    Date.now = realNow
  }
})

test('setting the same search key replaces the existing entry', () => {
  const key = `search-replace-${Date.now()}`
  const first = [song]
  const second = [{ ...song, videoId: 'video-2' }]
  setSearchCache(key, first)
  setSearchCache(key, second)
  assert.deepEqual(getSearchCache(key), second)
})

test('search cache keeps at most 200 entries', () => {
  const prefix = `search-limit-${Date.now()}-`

  for (let i = 0; i < 201; i++) setSearchCache(`${prefix}${i}`, [song])

  assert.equal(getSearchCache(`${prefix}0`), undefined)
  assert.deepEqual(getSearchCache(`${prefix}200`), [song])
})

test('reserveSearchQuota increments daily search count', () => {
  const before = getSearchesToday()
  assert.equal(reserveSearchQuota(), true)
  assert.equal(getSearchesToday(), before + 1)
  releaseSearchQuota()
})

test('releaseSearchQuota decreases daily search count', () => {
  const before = getSearchesToday()
  reserveSearchQuota()
  assert.equal(getSearchesToday(), before + 1)
  releaseSearchQuota()
  assert.equal(getSearchesToday(), before)
})

test('releaseSearchQuota never makes quota negative', () => {
  while (getSearchesToday() > 0) releaseSearchQuota()

  releaseSearchQuota()
  assert.equal(getSearchesToday(), 0)
})

test('reserveSearchQuota stops at the daily limit', () => {
  const reserved: boolean[] = []

  while (getSearchesToday() > 0) releaseSearchQuota()

  for (let i = 0; i < CACHE_LIMITS.MAX_DAILY_SEARCHES; i++) reserved.push(reserveSearchQuota())

  assert.equal(reserved.every(Boolean), true)
  assert.equal(getSearchesToday(), CACHE_LIMITS.MAX_DAILY_SEARCHES)
  assert.equal(reserveSearchQuota(), false)
  assert.equal(getSearchesToday(), CACHE_LIMITS.MAX_DAILY_SEARCHES)

  while (getSearchesToday() > 0) releaseSearchQuota()
})
