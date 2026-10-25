import { api } from './api.js'
import { state, on } from './state.js'
import { dom } from './dom.js'
import { views } from './views/index.js'
import { formatDateTime } from './ui.js'
import { t } from '../i18n.js'

// The fallback topic: the data is written to the store and the drawings are its subscribers; the watcher logs a read
// that fails
export function readFallback() {
  return api.getFallback().then((data) => {
    state.fallback = data
  })
}

export function renderFallback() {
  const data = state.fallback
  const tracks = data?.upNext ?? []

  dom.fallbackShuffleBtn.classList.toggle('active', Boolean(data?.shuffle))
  dom.fallbackRepeatBtn.classList.toggle('active', Boolean(data?.repeat))
  dom.fallbackEnabledBtn.classList.toggle('active', Boolean(data?.enabled))
  dom.fallbackEnabledText.textContent = data?.enabled ? t('common.on') : t('common.off')

  if (!tracks.length) {
    // the list is built again when tracks come back: it follows the playing track again then
    renderedActiveVideoId = undefined
    // an active playlist that has simply run out still counts as set; only a section with no playlist at all gets the hint
    dom.fallbackInfo.textContent = data?.playlistId ? '' : t('fallback.notSet')
    views.fallback.render([])
    return
  }

  const itemCount = Number.isFinite(data?.itemCount) ? data.itemCount : null

  dom.fallbackInfo.textContent = itemCount && itemCount > 0 && tracks.length !== itemCount
      ? t('fallback.infoOf', {
          count: tracks.length,
          total: itemCount,
          datetime: formatDateTime(data.lastRefreshedAt)
        })
      : t('fallback.info', {
          count: tracks.length,
          datetime: formatDateTime(data.lastRefreshedAt)
        })
  renderFallbackTracks()
}

let renderedActiveVideoId

// the active row follows the playing state, so a step of the rotation moves the highlight without reading the playlist
function renderFallbackTracks() {
  if (!state.fallback) return

  const activeVideoId = state.current?.isFallback ? state.current.videoId : ''
  views.fallback.render((state.fallback.upNext ?? []).map((track) => ({ ...track, isActive: track.videoId === activeVideoId })))

  if (activeVideoId !== renderedActiveVideoId) {
    renderedActiveVideoId = activeVideoId
    scrollToActiveFallback()
  }
}

on('fallback', renderFallback)
on('current', renderFallbackTracks)

export function scrollToActiveFallback() {
  const activeVideoId = state.current?.isFallback ? state.current.videoId : null
  const container = dom.fallbackListWrapper
  const list = container?.querySelector('.row-list')
  if (!activeVideoId || !container || !list) return

  const activeRow = list.querySelector(`[data-video-id="${CSS.escape(activeVideoId)}"]`)
  if (!activeRow) return

  const containerRect = container.getBoundingClientRect()
  const rowRect = activeRow.getBoundingClientRect()
  const rowCenter = rowRect.top + rowRect.height / 2
  const containerCenter = containerRect.top + containerRect.height / 2
  container.scrollBy({
    top: rowCenter - containerCenter,
    behavior: 'smooth'
  })
}
