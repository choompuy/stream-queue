import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { VideoItem } from '../../../src/youtube/types.js'
import { AppError, type Song } from '../../../src/types.js'

// updateConfig() saves to data/config.json under the working directory: use a throwaway one, not the real one
process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-test-')))

const { isAvailableInRegion, getFilterFailureReason, throwFilterError, isMusicVideo } = await import('../../../src/youtube/client.js')
const { updateConfig } = await import('../../../src/config.js')

function baseSong(overrides: Partial<Song> = {}): Song {
  return {
    videoId: 'dQw4w9WgXcQ',
    title: 'Rick Astley - Never Gonna Give You Up',
    channelTitle: 'Rick Astley',
    thumbnail: '',
    duration: 213,
    views: 1_000_000,
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    ...overrides
  }
}

function baseVideo(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'dQw4w9WgXcQ',
    snippet: { categoryId: '10' },
    status: { embeddable: true },
    ...overrides
  }
}

function videoWithRestriction(regionRestriction?: VideoItem['contentDetails']): VideoItem {
  return {
    id: 'dQw4w9WgXcQ',
    contentDetails: regionRestriction
  }
}

test('isAvailableInRegion', async (t) => {
  await t.test('no region code configured: always available', () => {
    const video = videoWithRestriction({ regionRestriction: { blocked: ['US'] } })
    assert.equal(isAvailableInRegion(video, ''), true)
  })

  await t.test('no restriction data on the video: always available', () => {
    const video = videoWithRestriction()
    assert.equal(isAvailableInRegion(video, 'US'), true)
  })

  await t.test('region is in the blocked list: unavailable', () => {
    const video = videoWithRestriction({ regionRestriction: { blocked: ['US', 'CA'] } })
    assert.equal(isAvailableInRegion(video, 'US'), false)
  })

  await t.test('region is not in the blocked list: available', () => {
    const video = videoWithRestriction({ regionRestriction: { blocked: ['US', 'CA'] } })
    assert.equal(isAvailableInRegion(video, 'DE'), true)
  })

  await t.test('allowed list present and region is in it: available', () => {
    const video = videoWithRestriction({ regionRestriction: { allowed: ['RU', 'DE'] } })
    assert.equal(isAvailableInRegion(video, 'RU'), true)
  })

  await t.test('allowed list present and region is not in it: unavailable', () => {
    const video = videoWithRestriction({ regionRestriction: { allowed: ['RU', 'DE'] } })
    assert.equal(isAvailableInRegion(video, 'US'), false)
  })
})

test('getFilterFailureReason', async (t) => {
  await t.test('permissive config, clean video: no rejection reason', () => {
    updateConfig({ minViews: 0, minDurationSeconds: 0, maxDurationSeconds: 100_000, regionCode: '' })
    assert.equal(getFilterFailureReason(baseSong(), baseVideo()), null)
  })

  await t.test('wrong category: NOT_MUSIC', () => {
    updateConfig({ minViews: 0, minDurationSeconds: 0, maxDurationSeconds: 100_000, regionCode: '' })
    const video = baseVideo({ snippet: { categoryId: '20' } })
    assert.equal(getFilterFailureReason(baseSong(), video), 'NOT_MUSIC')
  })

  await t.test('not embeddable: NOT_EMBEDDABLE', () => {
    updateConfig({ minViews: 0, minDurationSeconds: 0, maxDurationSeconds: 100_000, regionCode: '' })
    const video = baseVideo({ status: { embeddable: false } })
    assert.equal(getFilterFailureReason(baseSong(), video), 'NOT_EMBEDDABLE')
  })

  await t.test('duration outside configured range: DURATION_OUT_OF_RANGE', () => {
    updateConfig({ minViews: 0, minDurationSeconds: 60, maxDurationSeconds: 120, regionCode: '' })
    assert.equal(getFilterFailureReason(baseSong({ duration: 10 }), baseVideo()), 'DURATION_OUT_OF_RANGE')
  })

  await t.test('views below configured minimum: VIEWS_TOO_LOW', () => {
    updateConfig({ minViews: 5_000_000, minDurationSeconds: 0, maxDurationSeconds: 100_000, regionCode: '' })
    assert.equal(getFilterFailureReason(baseSong({ views: 100 }), baseVideo()), 'VIEWS_TOO_LOW')
  })

  await t.test('blocked in configured region: REGION_BLOCKED', () => {
    updateConfig({ minViews: 0, minDurationSeconds: 0, maxDurationSeconds: 100_000, regionCode: 'RU' })
    const video = baseVideo({ contentDetails: { regionRestriction: { blocked: ['RU'] } } })
    assert.equal(getFilterFailureReason(baseSong(), video), 'REGION_BLOCKED')
  })
})

test('contentMode', async (t) => {
  const open = { minViews: 0, minDurationSeconds: 0, maxDurationSeconds: 3600, regionCode: '' }
  const clip = baseVideo({ snippet: { categoryId: '24' }, topicDetails: { topicCategories: ['https://en.wikipedia.org/wiki/Pop_music'] } })
  const game = baseVideo({ snippet: { categoryId: '20' }, topicDetails: { topicCategories: ['https://en.wikipedia.org/wiki/Video_game'] } })

  await t.test('music: category 10 passes, a clip filed elsewhere passes through its music topic, other topics do not', () => {
    updateConfig({ ...open, contentMode: 'music' })

    assert.equal(isMusicVideo(baseVideo()), true)
    assert.equal(isMusicVideo(clip), true)
    assert.equal(isMusicVideo(game), false)
    assert.equal(getFilterFailureReason(baseSong(), clip), null)
    assert.equal(getFilterFailureReason(baseSong(), game), 'NOT_MUSIC')
  })

  await t.test('any: the music check is switched off', () => {
    updateConfig({ ...open, contentMode: 'any' })

    assert.equal(getFilterFailureReason(baseSong(), game), null)
    updateConfig({ contentMode: 'music' })
  })
})

test('live streams', async (t) => {
  const live = baseVideo({ snippet: { categoryId: '10', liveBroadcastContent: 'live' } })
  const stream = baseSong({ duration: 0 })
  const open = { minViews: 0, minDurationSeconds: 60, maxDurationSeconds: 480, regionCode: '' }

  await t.test('refused as IS_LIVE (not as a bad duration) when live streams are not allowed', () => {
    updateConfig({ ...open, allowLiveStreams: false })
    assert.equal(getFilterFailureReason(stream, live), 'IS_LIVE')
  })

  await t.test('accepted when allowed: the duration rules do not apply to a stream', () => {
    updateConfig({ ...open, allowLiveStreams: true })
    assert.equal(getFilterFailureReason(stream, live), null)
    updateConfig({ allowLiveStreams: false })
  })
})

test('scheduled streams', async (t) => {
  const open = { minViews: 0, minDurationSeconds: 60, maxDurationSeconds: 480, regionCode: '' }
  const upcoming = baseVideo({ snippet: { categoryId: '10', liveBroadcastContent: 'upcoming' } })
  const live = baseVideo({ snippet: { categoryId: '10', liveBroadcastContent: 'live' } })

  await t.test('an upcoming stream or premiere is refused even when live streams are allowed: there is nothing to play yet', () => {
    updateConfig({ ...open, allowLiveStreams: true })
    assert.equal(getFilterFailureReason(baseSong({ duration: 0 }), upcoming), 'NOT_PLAYABLE')
  })

  await t.test('a stream that is on now is still accepted when live streams are allowed', () => {
    updateConfig({ ...open, allowLiveStreams: true })
    assert.equal(getFilterFailureReason(baseSong({ duration: 0 }), live), null)
    updateConfig({ allowLiveStreams: false })
  })
})

test('throwFilterError', async (t) => {
  await t.test('REGION_BLOCKED does not leak the configured region', () => {
    const config = { regionCode: 'RU' } as Parameters<typeof throwFilterError>[1]
    assert.throws(
      () => throwFilterError('REGION_BLOCKED', config),
      (error: unknown) => error instanceof AppError && error.code === 'REGION_BLOCKED' && error.params === undefined
    )
  })

  await t.test('DURATION_OUT_OF_RANGE carries the configured bounds', () => {
    const config = { minDurationSeconds: 60, maxDurationSeconds: 480 } as Parameters<typeof throwFilterError>[1]
    assert.throws(
      () => throwFilterError('DURATION_OUT_OF_RANGE', config),
      (error: unknown) => error instanceof AppError && error.params?.min === 60 && error.params?.max === 480
    )
  })

  await t.test('VIEWS_TOO_LOW carries the configured minimum', () => {
    const config = { minViews: 10_000 } as Parameters<typeof throwFilterError>[1]
    assert.throws(
      () => throwFilterError('VIEWS_TOO_LOW', config),
      (error: unknown) => error instanceof AppError && error.params?.min === 10_000
    )
  })

  await t.test('NOT_MUSIC and NOT_EMBEDDABLE throw with no params', () => {
    const config = {} as Parameters<typeof throwFilterError>[1]
    assert.throws(
      () => throwFilterError('NOT_MUSIC', config),
      (error: unknown) => error instanceof AppError && error.code === 'NOT_MUSIC'
    )
    assert.throws(
      () => throwFilterError('NOT_EMBEDDABLE', config),
      (error: unknown) => error instanceof AppError && error.code === 'NOT_EMBEDDABLE'
    )
  })
})

test.after(() => {
  updateConfig({ minViews: 10_000, minDurationSeconds: 60, maxDurationSeconds: 480, regionCode: '' })
})
