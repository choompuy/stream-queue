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

const playlist = (activeVideoId, upNext = [track('a'), track('b')]) => ({
  upNext,
  activeVideoId,
  enabled: true,
  shuffle: false,
  repeat: false,
  lastRefreshedAt: 0,
  sourceCount: upNext.length
})

test('the playlist follows the track that plays', async (t) => {
  await t.test('once per track: a refresh that changes nothing does not pull the list back', () => {
    scrolls = 0
    state.fallback = playlist(V('a'))

    renderFallback()
    renderFallback()
    renderFallback()
    assert.equal(scrolls, 1)

    state.fallback = playlist(V('b'))
    renderFallback()
    renderFallback()
    assert.equal(scrolls, 2)
  })

  await t.test('and again when the list was empty in between', () => {
    scrolls = 0
    state.fallback = playlist(V('b'), [])
    renderFallback()
    state.fallback = playlist(V('b'))
    renderFallback()

    assert.equal(scrolls, 1)
  })
})

test('the sections of the dashboard', async (t) => {
  await t.test('the list is scrolled when the playlist is shown, not when another section is', () => {
    state.fallback = playlist(V('a'))
    scrolls = 0

    switchSection('playlist')
    assert.equal(scrolls, 1)

    switchSection('activity')
    switchSection('blocklist')
    switchSection('queue')
    assert.equal(scrolls, 1)
  })
})
