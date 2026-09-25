export class ApiError extends Error {
  constructor(message, { status, code, params, cause } = {}) {
    super(message, { cause })
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.params = params
  }
}

async function request(url, options = {}) {
  let response

  try {
    response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    })
  } catch (cause) {
    // fetch rejects only when the server cannot be reached at all
    throw new ApiError('Network error', { code: 'NETWORK_ERROR', cause })
  }

  let body = null

  try {
    body = await response.json()
  } catch {
    // Empty/non-JSON response
  }

  if (!response.ok) {
    throw new ApiError(body?.error || `Request failed: ${response.status}`, {
      status: response.status,
      code: body?.code,
      params: body?.params
    })
  }

  return body?.data ?? null
}

const post = (url, body) => request(url, { method: 'POST', ...(body !== undefined && { body: JSON.stringify(body) }) })
const put = (url, body) => request(url, { method: 'PUT', body: JSON.stringify(body) })
const del = (url) => request(url, { method: 'DELETE' })
const id = encodeURIComponent

export const api = {
  getSettings: () => request('/api/settings'),
  updateSettings: (settings) => put('/api/settings', settings),

  getLocale: () => request('/api/locale'),
  updateLocale: (locale) => put('/api/locale', { locale }),

  getConfig: () => request('/api/config'),
  updateConfig: (config) => put('/api/config', config),

  getSecrets: () => request('/api/secrets'),
  updateSecrets: (secrets) => put('/api/secrets', secrets),

  getState: () => request('/api/state'),
  search: (query) => request(`/api/search?q=${id(query)}&admin=1`),
  requestSong: (query) => post('/api/queue/request', { query, requestedBy: 'ControlPanel', admin: true }),
  removeFromQueue: (index) => del(`/api/queue/${index}`),
  clearQueue: () => post('/api/queue/clear'),

  skip: () => post('/api/player/skip'),
  pause: () => post('/api/player/pause'),
  resume: () => post('/api/player/resume'),

  getFallback: () => request('/api/fallback'),
  refreshFallback: () => post('/api/fallback/refresh'),
  shuffleFallback: () => post('/api/fallback/shuffle'),
  repeatFallback: () => post('/api/fallback/repeat'),
  enabledFallback: () => post('/api/fallback/enabled'),
  playFallback: (videoId) => post(`/api/fallback/play/${id(videoId)}`),
  enqueueFallback: (videoId) => post(`/api/fallback/enqueue/${id(videoId)}`),

  getNetworkInfo: () => request('/api/network-info'),

  getPlaylists: () => request('/api/playlists'),
  addPlaylist: (playlistId) => post('/api/playlists', { playlistId }),
  removePlaylist: (playlistId) => del(`/api/playlists/${id(playlistId)}`),
  activatePlaylist: (playlistId) => post(`/api/playlists/${id(playlistId)}/activate`),

  getActivity: () => request('/api/activity'),
  clearActivity: () => post('/api/activity/clear'),

  getBlocklist: () => request('/api/blocklist'),
  blockTrack: (videoId, title) => post('/api/blocklist', { videoId, title }),
  unblockTrack: (videoId) => del(`/api/blocklist/${id(videoId)}`),
  
  getTwitchStatus: () => request('/api/integrations/twitch'),
  connectTwitch: () => post('/api/integrations/twitch/connect'),
  getTwitchRewards: () => request('/api/integrations/twitch/rewards'),
  disconnectTwitch: () => post('/api/integrations/twitch/disconnect'),
  refreshTwitch: () => post('/api/integrations/twitch/refresh')
}
