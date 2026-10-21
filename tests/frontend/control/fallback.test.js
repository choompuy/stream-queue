import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setupPanel, makeTrack as track, V } from './panel-env.js'

setupPanel()

let scrolls = 0
window.HTMLElement.prototype.scrollBy = () => {
  scrolls++
}

const { state } = await import('../../../public/js/control/state.js')
const { renderFallback } = await import('../../../public/js/control/fallback.js')
const { switchSection } = await import('../../../public/js/control/tabs.js')

// the row that is active is the one the player plays, when that is a track of the playlist
const play = (videoId) => {
  state.current = videoId ? { ...track(videoId.slice(0, 1)), videoId, isFallback: true } : null
}

const playlist = (upNext = [track('a'), track('b')]) => ({
  upNext,
  enabled: true,
  shuffle: false,
  repeat: false,
  lastRefreshedAt: 0,
  sourceCount: upNext.length
})

test('the playlist follows the track that plays', async (t) => {
  await t.test('once per track: a refresh that changes nothing does not pull the list back', () => {
    scrolls = 0
    state.fallback = playlist()
    play(V('a'))

    renderFallback()
    renderFallback()
    renderFallback()
    assert.equal(scrolls, 1)

    play(V('b'))
    renderFallback()
    renderFallback()
    assert.equal(scrolls, 2)
  })

  await t.test('and again when the list was empty in between', () => {
    scrolls = 0
    play(V('b'))
    state.fallback = playlist([])
    renderFallback()
    state.fallback = playlist()
    renderFallback()

    assert.equal(scrolls, 1)
  })
})

test('the sections of the dashboard', async (t) => {
  await t.test('the list is scrolled when the playlist is shown, not when another section is', () => {
    state.fallback = playlist()
    play(V('a'))
    scrolls = 0

    switchSection('playlist')
    assert.equal(scrolls, 1)

    switchSection('activity')
    switchSection('blocklist')
    switchSection('queue')
    assert.equal(scrolls, 1)
  })
})
