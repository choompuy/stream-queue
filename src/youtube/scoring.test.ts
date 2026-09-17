import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Song } from '../types.js'
import { normalize, isoDurationToSeconds, combinedScore, formatViews } from './scoring.js'

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

test('normalize', async (t) => {
  await t.test('lowercases and collapses punctuation to single spaces', () => {
    assert.equal(normalize('Hello,  World!!'), 'hello world')
  })

  await t.test('strips underscores (not letters/numbers)', () => {
    assert.equal(normalize('__proto__'), 'proto')
  })

  await t.test('keeps non-Latin letters', () => {
    assert.equal(normalize('Кино - Группа крови'), 'кино группа крови')
  })

  await t.test('empty string', () => {
    assert.equal(normalize(''), '')
  })
})

test('isoDurationToSeconds', async (t) => {
  await t.test('minutes and seconds', () => {
    assert.equal(isoDurationToSeconds('PT4M13S'), 253)
  })

  await t.test('hours, minutes and seconds', () => {
    assert.equal(isoDurationToSeconds('PT1H2M3S'), 3723)
  })

  await t.test('seconds only', () => {
    assert.equal(isoDurationToSeconds('PT45S'), 45)
  })

  await t.test('unparseable string is treated as infinitely long (filtered out)', () => {
    assert.equal(isoDurationToSeconds('not-a-duration'), Infinity)
  })

  await t.test('missing input defaults to Infinity', () => {
    assert.equal(isoDurationToSeconds(), Infinity)
  })
})

test('combinedScore', async (t) => {
  await t.test('exact title match beats a partial match', () => {
    const exact = combinedScore(baseSong({ title: 'never gonna give you up' }), 'never gonna give you up')
    const partial = combinedScore(baseSong({ title: 'never gonna give you up (extended remix)' }), 'never gonna give you up')
    assert.ok(exact > partial)
  })

  await t.test('an official/topic/vevo channel outscores an unrelated channel, same (partial-match) title', () => {
    const partialTitle = 'Give You Up (Never Gonna) - Rick Astley'
    const official = combinedScore(baseSong({ title: partialTitle, channelTitle: 'RickAstleyVEVO' }), 'never gonna give you up')
    const random = combinedScore(baseSong({ title: partialTitle, channelTitle: 'Some Rando' }), 'never gonna give you up')
    assert.ok(official > random)
  })

  await t.test('more views scores higher, all else equal', () => {
    const popular = combinedScore(baseSong({ views: 1_000_000_000 }), 'never gonna give you up')
    const unpopular = combinedScore(baseSong({ views: 10 }), 'never gonna give you up')
    assert.ok(popular > unpopular)
  })

  await t.test('a duration inside the ideal 150-420s window beats one far outside it', () => {
    const ideal = combinedScore(baseSong({ duration: 200 }), 'never gonna give you up')
    const tooLong = combinedScore(baseSong({ duration: 3600 }), 'never gonna give you up')
    assert.ok(ideal > tooLong)
  })

  await t.test('no title/query overlap still returns a finite, non-negative score', () => {
    const score = combinedScore(baseSong({ title: 'xyz' }), 'never gonna give you up')
    assert.ok(Number.isFinite(score))
    assert.ok(score >= 0)
  })
})

test('formatViews', async (t) => {
  await t.test('millions', () => {
    assert.equal(formatViews(2_500_000), '2.5M')
  })

  await t.test('thousands', () => {
    assert.equal(formatViews(15_400), '15.4K')
  })

  await t.test('below one thousand', () => {
    assert.equal(formatViews(999), '999')
  })
})
