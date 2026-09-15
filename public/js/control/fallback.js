import { api } from './api.js'
import { state, dom, views, log, renderStats } from './state.js'
import { toggleActive, formatDateTime, withLoading } from './ui.js'
import { refreshState } from './queue.js'
import { t } from '../i18n.js'
import { toastSuccess } from './toast.js'

export async function refreshFallbackState() {
  try {
    state.fallback = await api.getFallback()
    renderFallback()
  } catch (error) {
    log('Error fetching fallback playlist:', error)
  }
}

export function renderFallback() {
  const data = state.fallback
  const tracks = data?.upNext ?? []
  const activeVideoId = data?.activeVideoId ?? ''
  const list = dom.fallbackListWrapper.querySelector('.row-list')

  if (list) list.dataset.activeVideoId = activeVideoId

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
  views.fallback.render(tracks)
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

export async function refreshFallback() {
  await withLoading(dom.fallbackRefreshBtn, async () => {
    try {
      await api.refreshFallback()
      await refreshFallbackState()
      toastSuccess(t('toast.fallbackRefreshed'))
    } catch (error) {
      log('Error refreshing fallback:', error)
    }
  })
}

export async function toggleFallbackShuffle() {
  try {
    state.fallback = await api.shuffleFallback()
    views.fallback.invalidate()
    renderFallback()
  } catch (error) {
    log('Failed to toggle shuffle:', error)
  }
}

export async function toggleFallbackRepeat() {
  try {
    state.fallback = await api.repeatFallback()
    renderFallback()
  } catch (error) {
    log('Failed to toggle repeat:', error)
  }
}

export async function toggleFallbackEnabled() {
  try {
    state.fallback = await api.enabledFallback()
    renderFallback()
  } catch (error) {
    log('Failed to toggle enabled:', error)
  }
}

export async function playFallbackNow(videoId) {
  const title = state.fallback?.upNext?.find((track) => track.videoId === videoId)?.title
  try {
    await api.playFallback(videoId)
    await refreshState()
    if (title) toastSuccess(t('toast.nowPlaying', { title }))
  } catch (error) {
    log('Error playing fallback track:', error)
  }
}

export async function enqueueFallbackTrack(videoId) {
  const title = state.fallback?.upNext?.find((track) => track.videoId === videoId)?.title
  try {
    await api.enqueueFallback(videoId)
    await refreshState()
    if (title) toastSuccess(t('toast.addedToQueue', { title, position: state.queue.length }))
  } catch (error) {
    log('Error queueing fallback track:', error)
  }
}
