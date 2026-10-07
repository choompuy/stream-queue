import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalize, isoDurationToSeconds, formatViews } from '../../../src/youtube/utils.js'

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

test('isoDurationToSeconds: live streams and long videos', async (t) => {
  await t.test('P0D (a live stream or premiere without a length yet) is 0, not Infinity', () => {
    assert.equal(isoDurationToSeconds('P0D'), 0)
  })

  await t.test('days are counted', () => {
    assert.equal(isoDurationToSeconds('P1DT2H'), 93600)
  })

  await t.test('something that is not a duration is Infinity (out of any allowed range)', () => {
    for (const value of ['', 'x', 'P', 'PT', 'PT5']) assert.equal(isoDurationToSeconds(value), Infinity, JSON.stringify(value))
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
