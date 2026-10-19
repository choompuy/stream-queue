import { api } from './api.js'
import { state } from './state.js'
import { dom } from './dom.js'
import { renderStats } from './stats.js'
import { views } from './views/index.js'
import { run } from './run.js'
import { formatDateTime } from './ui.js'
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

// the list follows the track that plays once per track, not at every refresh: the person may be looking at another part of it then
let followedVideoId = null

export function renderFallback() {
  const data = state.fallback
  const tracks = data?.upNext ?? []
  const activeVideoId = data?.activeVideoId ?? ''

  dom.fallbackShuffleBtn.classList.toggle('active', Boolean(data?.shuffle))
  dom.fallbackRepeatBtn.classList.toggle('active', Boolean(data?.repeat))
  dom.fallbackEnabledBtn.classList.toggle('active', Boolean(data?.enabled))
  setText(dom.fallbackEnabledText, data?.enabled ? t('common.on') : t('common.off'))

  if (!tracks.length) {
    followedVideoId = null
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
  views.fallback.render(tracks.map((track) => ({ ...track, isActive: track.videoId === activeVideoId })))
  if (activeVideoId !== followedVideoId) {
    followedVideoId = activeVideoId
    scrollToActiveFallback()
  }
  renderStats()
}

export function scrollToActiveFallback() {
  const activeVideoId = state.fallback?.activeVideoId
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
