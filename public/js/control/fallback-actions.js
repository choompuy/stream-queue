import { api } from './api.js'
import { state } from './state.js'
import { t } from '../i18n.js'
import { toastSuccess } from './toast.js'

// Every answer of these is the new state of the playlist: it goes to the store, and the store draws the list
export async function refreshFallback() {
  state.fallback = await api.refreshFallback()
  toastSuccess(t('toast.fallbackRefreshed'))
}

export async function toggleFallbackShuffle() {
  state.fallback = await api.shuffleFallback()
}

export async function toggleFallbackRepeat() {
  state.fallback = await api.repeatFallback()
}

export async function toggleFallbackEnabled() {
  state.fallback = await api.enabledFallback()
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
