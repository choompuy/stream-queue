import { api } from './api.js'
import { state, dom, selectors, renderStats } from './state.js'
import { views } from './views/index.js'
import { run } from './run.js'
import { toggleActive, formatDateTime } from './ui.js'
import { t } from '../i18n.js'

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
  const activeVideoId = data?.activeVideoId ?? ''

  toggleActive(dom.fallbackShuffleBtn, data?.shuffle)
  toggleActive(dom.fallbackRepeatBtn, data?.repeat)
  toggleActive(dom.fallbackEnabledBtn, data?.enabled)
  if (dom.fallbackEnabledText) dom.fallbackEnabledText.textContent = data?.enabled ? t('common.on') : t('common.off')

  if (!tracks.length) {
    if (dom.fallbackInfo) dom.fallbackInfo.textContent = ''
    views.fallback.render([])
    renderStats()
    return
  }

  if (dom.fallbackInfo) {
    dom.fallbackInfo.textContent = t('fallback.info', {
      count: tracks.length,
      datetime: formatDateTime(data.lastRefreshedAt)
    })
  }
  views.fallback.render(selectors.markBlocked(tracks).map((track) => ({ ...track, isActive: track.videoId === activeVideoId })))
  scrollToActiveFallback()
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
