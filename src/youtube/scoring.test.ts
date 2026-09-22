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

test('titleScore ranking (via combinedScore, views/duration held equal unless noted)', async (t) => {
  const equalPopularity = (title: string, channelTitle?: string) => baseSong({ title, views: 100_000, duration: 200, channelTitle: channelTitle ?? 'Channel' })

  await t.test('an unrequested remix/version tag never outranks the plain title, even with far more views', () => {
    const query = 'Never Gonna Give You Up'
    const official = combinedScore(baseSong({ title: 'Rick Astley - Never Gonna Give You Up (Official Video)', views: 1_500_000_000, duration: 213, channelTitle: 'RickAstleyVEVO' }), query)

    for (const [title, views] of [
      ['Never Gonna Give You Up (8-Bit Remix)', 80_000_000],
      ['Never Gonna Give You Up - Nightcore Version', 30_000_000],
      ['never gonna give you up (sped up + reverb)', 120_000_000]
    ] as const) {
      assert.ok(combinedScore(baseSong({ title, views, duration: 190 }), query) < official, title)
    }
  })

  await t.test('when the query itself asks for a version, a title with that same tag is not penalized for it', () => {
    const query = 'Never Gonna Give You Up 8-Bit Remix'
    const remix = combinedScore(baseSong({ title: 'Never Gonna Give You Up (8-Bit Remix)', views: 80_000_000, duration: 190 }), query)
    const official = combinedScore(baseSong({ title: 'Rick Astley - Never Gonna Give You Up (Official Video)', views: 1_500_000_000, duration: 213, channelTitle: 'RickAstleyVEVO' }), query)

    assert.ok(remix > official, 'the requested remix should outrank the official upload when the remix was asked for')
  })

  await t.test('a long query: an exact match outranks a cover even when the cover has a version tag spliced into the middle of the matching text', () => {
    const query = 'Artist Name - Some Very Specific Long Song Title (Official Video)'
    const exact = combinedScore(baseSong({ title: query, views: 1000, duration: 200 }), query)
    const cover = combinedScore(baseSong({ title: 'Artist Name - Some Very Specific Long Song Title (Cover by Someone) (Official Video)', views: 500_000, duration: 200 }), query)

    assert.ok(exact > cover)
  })

  await t.test('at the same title length/coverage, a clean substring beats reordered words, which beats a partial match', () => {
    // same total length in every title, so the tiers are compared at equal "coverage" rather than confounding
    // tier with length
    const query = 'Song Title'
    const substring = titleScoreFor('Song Title Album', query) // clean run + one extra word
    const reordered = titleScoreFor('Title Song Album', query) // same words, reordered
    const partial = titleScoreFor('Song Other Album', query) // only one query word present

    assert.ok(substring > reordered, 'a contiguous substring should beat the same words out of order')
    assert.ok(reordered > partial, 'all words present should beat only some of them present')
  })

  await t.test('an exact match beats a substring match of the same query inside a longer title', () => {
    const query = 'Song Title'
    assert.ok(titleScoreFor('Song Title', query) > titleScoreFor('Song Title Album', query))
  })

  await t.test('within the substring tier, more non-matching padding in the title scores lower (no version words involved)', () => {
    const query = 'Song Title'
    const shortPadding = titleScoreFor('Song Title Extended', query)
    const longPadding = titleScoreFor('Song Title From The Motion Picture Original Soundtrack Deluxe Edition', query)

    assert.ok(shortPadding > longPadding)
  })

  function titleScoreFor(title: string, query: string): number {
    // isolates the title-score contribution by holding views/duration fixed across all four calls
    return combinedScore(equalPopularity(title), query)
  }

  await t.test('a title that merely shares one common word with a long query does not beat an exact match at any realistic popularity gap', () => {
    const query = 'Song Title Remix'
    const exact = combinedScore(baseSong({ title: 'Song Title', views: 1000, duration: 200 }), query)
    const unrelated = combinedScore(baseSong({ title: 'Completely Different Track (Song Remix Cover)', views: 10_000_000, duration: 200 }), query)

    assert.ok(exact > unrelated)
  })
})
