import { api } from './api.js'
import { state, dom, selectors, renderStats } from './state.js'
import { views } from './views/index.js'
import { run } from './run.js'
import { toggleActive, formatDateTime } from './ui.js'
import { refreshState } from './queue.js'
import { t } from '../i18n.js'
import { toastSuccess } from './toast.js'

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
  dom.fallbackEnabledText.textContent = data?.enabled ? t('common.on') : t('common.off')

  if (!tracks.length) {
    dom.fallbackInfo.textContent = ''
    views.fallback.render([])
    renderStats()
    return
  }

  dom.fallbackInfo.textContent = t('fallback.info', {
    count: tracks.length,
    datetime: formatDateTime(data.lastRefreshedAt)
  })
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

export function refreshFallback() {
  return run(
    'refreshing fallback',
    async () => {
      await api.refreshFallback()
      await refreshFallbackState()
      toastSuccess(t('toast.fallbackRefreshed'))
    },
    { button: dom.fallbackRefreshBtn }
  )
}

export function toggleFallbackShuffle() {
  return run('toggling shuffle', async () => {
    state.fallback = await api.shuffleFallback()
    views.fallback.invalidate()
    renderFallback()
  })
}

export function toggleFallbackRepeat() {
  return run('toggling repeat', async () => {
    state.fallback = await api.repeatFallback()
    renderFallback()
  })
}

export function toggleFallbackEnabled() {
  return run('toggling enabled', async () => {
    state.fallback = await api.enabledFallback()
    renderFallback()
  })
}

const fallbackTitle = (videoId) => state.fallback?.upNext?.find((track) => track.videoId === videoId)?.title

export function playFallbackNow(videoId) {
  const title = fallbackTitle(videoId)

  return run('playing fallback track', async () => {
    await api.playFallback(videoId)
    await refreshState()
    if (title) toastSuccess(t('toast.nowPlaying', { title }))
  })
}

export function enqueueFallbackTrack(videoId) {
  const title = fallbackTitle(videoId)

  return run('queueing fallback track', async () => {
    await api.enqueueFallback(videoId)
    await refreshState()
    if (title) toastSuccess(t('toast.addedToQueue', { title, position: state.queue.length }))
  })
}

export const fallbackActions = {
  'fallback-refresh': refreshFallback,
  'fallback-shuffle': toggleFallbackShuffle,
  'fallback-repeat': toggleFallbackRepeat,
  'fallback-enabled': toggleFallbackEnabled,
  'fallback-play': (element) => playFallbackNow(element.dataset.videoId),
  'fallback-enqueue': (element) => enqueueFallbackTrack(element.dataset.videoId)
}
