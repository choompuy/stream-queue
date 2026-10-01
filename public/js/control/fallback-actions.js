import { api } from './api.js'
import { state, dom } from './state.js'
import { views } from './views/index.js'
import { run } from './run.js'
import { refreshState } from './queue.js'
import { refreshFallbackState, renderFallback } from './fallback.js'
import { t } from '../i18n.js'
import { toastSuccess } from './toast.js'

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
