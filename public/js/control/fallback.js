import { api } from './api.js'
import { state, dom, views, log, renderStats } from './state.js'
import { toggleActive, formatDateTime, withLoading } from './ui.js'
import { refreshState } from './queue.js'

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
  dom.fallbackEnabledText.textContent = data?.enabled ? 'Off' : 'On'

  if (!tracks.length) {
    dom.fallbackInfo.textContent = ''
    views.fallback.render([])
    renderStats()
    return
  }

  dom.fallbackInfo.textContent = `${tracks.length} tracks ▪ updated ${formatDateTime(data.lastRefreshedAt)}`
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
  try {
    await api.playFallback(videoId)
    await refreshState()
  } catch (error) {
    log('Error playing fallback track:', error)
  }
}

export async function enqueueFallbackTrack(videoId) {
  try {
    await api.enqueueFallback(videoId)
    await refreshState()
  } catch (error) {
    log('Error queueing fallback track:', error)
  }
}
