import { api } from './api.js'
import { state } from './state.js'
import { dom } from './dom.js'
import { renderStats } from './stats.js'
import { views } from './views/index.js'
import { run } from './run.js'
import { toggleActive, formatDateTime } from './ui.js'
import { t } from '../i18n.js'
import { setText } from '../shared.js'

export function refreshFallbackState(silent = false) {
  return run(
    'fetching fallback playlist',
    async () => {
      state.fallback = await api.getFallback()
      renderFallback()
    },
    { silent }
  )
}

export function renderFallback() {
  const data = state.fallback
  const tracks = data?.upNext ?? []

  toggleActive(dom.fallbackShuffleBtn, data?.shuffle)
  toggleActive(dom.fallbackRepeatBtn, data?.repeat)
  toggleActive(dom.fallbackEnabledBtn, data?.enabled)
  setText(dom.fallbackEnabledText, data?.enabled ? t('common.on') : t('common.off'))

  if (!tracks.length) {
    setText(dom.fallbackInfo, '')
    views.fallback.render([])
    renderStats()
    return
  }

  setText(
    dom.fallbackInfo,
    t('fallback.info', {
      count: tracks.length,
      datetime: formatDateTime(data.lastRefreshedAt)
    })
  )
  renderFallbackTracks()
  renderStats()
}

let renderedActiveVideoId

// the active row follows the playing state, so a step of the rotation moves the highlight without reading the playlist
export function renderFallbackTracks() {
  if (!state.fallback) return

  const activeVideoId = state.current?.isFallback ? state.current.videoId : ''
  views.fallback.render((state.fallback.upNext ?? []).map((track) => ({ ...track, isActive: track.videoId === activeVideoId })))

  if (activeVideoId !== renderedActiveVideoId) {
    renderedActiveVideoId = activeVideoId
    scrollToActiveFallback()
  }
}

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
