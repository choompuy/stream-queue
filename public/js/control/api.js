import { t } from '../i18n.js'
import { translateErrorCode } from '../shared.js'
import { toastError } from './toast.js'

async function request(url, options = {}, silent = false) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  })

  let data = null

  try {
    data = await response.json()
  } catch {
    // Empty/non-JSON response
  }

  if (!response.ok) {
    const error = new Error(data?.error || `Request failed: ${response.status}`)
    error.code = data?.code
    error.params = data?.params
    if (!silent) toastError(translateErrorCode(t, error.code, error.params, error.message))
    throw error
  }

  return data
}

export const api = {
  getSettings: () => request('/api/settings'),

  updateSettings: (settings) =>
    request('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(settings)
    }),

  getLocale: () => request('/api/locale'),

  updateLocale: (locale) =>
    request('/api/locale', {
      method: 'PUT',
      body: JSON.stringify({ locale })
    }),

  getConfig: () => request('/api/config'),

  updateConfig: (config) =>
    request('/api/config', {
      method: 'PUT',
      body: JSON.stringify(config)
    }),

  getSecrets: () => request('/api/secrets'),

  updateSecrets: (secrets) =>
    request('/api/secrets', {
      method: 'PUT',
      body: JSON.stringify(secrets)
    }),

  getState: (silent) => request('/api/state', {}, silent),

  search: (query) => request(`/api/search?q=${encodeURIComponent(query)}&admin=1`),

  requestSong: (query) =>
    request('/api/queue/request', {
      method: 'POST',
      body: JSON.stringify({
        query,
        requestedBy: 'ControlPanel',
        admin: true
      })
    }),

  removeFromQueue: (index) =>
    request(`/api/queue/${index}`, {
      method: 'DELETE'
    }),

  clearQueue: () =>
    request('/api/queue/clear', {
      method: 'POST'
    }),

  skip: () =>
    request('/api/player/skip', {
      method: 'POST'
    }),

  pause: () =>
    request('/api/player/pause', {
      method: 'POST'
    }),

  resume: () =>
    request('/api/player/resume', {
      method: 'POST'
    }),

  getFallback: (silent) => request('/api/fallback', {}, silent),

  refreshFallback: () =>
    request('/api/fallback/refresh', {
      method: 'POST'
    }),

  shuffleFallback: () =>
    request('/api/fallback/shuffle', {
      method: 'POST'
    }),

  repeatFallback: () =>
    request('/api/fallback/repeat', {
      method: 'POST'
    }),

  enabledFallback: () =>
    request('/api/fallback/enabled', {
      method: 'POST'
    }),

  playFallback: (videoId) =>
    request(`/api/fallback/play/${encodeURIComponent(videoId)}`, {
      method: 'POST'
    }),

  enqueueFallback: (videoId) =>
    request(`/api/fallback/enqueue/${encodeURIComponent(videoId)}`, {
      method: 'POST'
    }),

  getNetworkInfo: () => request('/api/network-info'),

  getPlaylists: () => request('/api/playlists'),

  addPlaylist: (playlistId) =>
    request('/api/playlists', {
      method: 'POST',
      body: JSON.stringify({ playlistId })
    }),

  removePlaylist: (id) =>
    request(`/api/playlists/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    }),

  activatePlaylist: (id) =>
    request(`/api/playlists/${encodeURIComponent(id)}/activate`, {
      method: 'POST'
    }),

  getActivity: (silent) => request('/api/activity', {}, silent),

  clearActivity: () =>
    request('/api/activity/clear', {
      method: 'POST'
    })
}
