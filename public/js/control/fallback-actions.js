import { api } from './api.js'
import { state } from './state.js'
import { views } from './views/index.js'
import { renderFallback } from './fallback.js'
import { t } from '../i18n.js'
import { toastSuccess } from './toast.js'

export async function refreshFallback() {
  state.fallback = await api.refreshFallback()
  renderFallback()
  toastSuccess(t('toast.fallbackRefreshed'))
}

export async function toggleFallbackShuffle() {
  state.fallback = await api.shuffleFallback()
  views.fallback.invalidate()
  renderFallback()
}

export async function toggleFallbackRepeat() {
  state.fallback = await api.repeatFallback()
  renderFallback()
}

export async function toggleFallbackEnabled() {
  state.fallback = await api.enabledFallback()
  renderFallback()
}

const fallbackTitle = (videoId) => state.fallback?.upNext?.find((track) => track.videoId === videoId)?.title

export async function playFallbackNow(videoId) {
  const title = fallbackTitle(videoId)

  await api.playFallback(videoId)
  if (title) toastSuccess(t('toast.nowPlaying', { title }))
}

export async function enqueueFallbackTrack(videoId) {
  const title = fallbackTitle(videoId)

  const answer = await api.enqueueFallback(videoId)
  if (title) toastSuccess(t('toast.addedToQueue', { title, position: answer.state.queue.length }))
}

export const fallbackActions = {
  'fallback-refresh': refreshFallback,
  'fallback-shuffle': toggleFallbackShuffle,
  'fallback-repeat': toggleFallbackRepeat,
  'fallback-enabled': toggleFallbackEnabled,
  'fallback-play': (element) => playFallbackNow(element.dataset.videoId),
  'fallback-enqueue': (element) => enqueueFallbackTrack(element.dataset.videoId)
}
