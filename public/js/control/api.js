import { request as http, ApiError } from '../http.js'

export { ApiError }

// a change the panel itself made is not read back here: with the events open the server announces what changed,
// and while they are down the safety poll of the watcher reads everything again soon enough
async function request(url, options = {}) {
  return http(url, options)
}

const send = (method) => (url, body) => request(url, { method, ...(body !== undefined && { body: JSON.stringify(body) }) })
const post = send('POST')
const put = send('PUT')
const patch = send('PATCH')
const del = send('DELETE')
const id = encodeURIComponent

export const api = {
  getSettings: () => request('/api/settings'),
  updateSettings: (settings) => put('/api/settings', settings),

  getConfig: () => request('/api/config'),
  updateConfig: (config) => put('/api/config', config),

  getSecrets: () => request('/api/secrets'),
  updateSecrets: (secrets) => put('/api/secrets', secrets),

  getState: () => request('/api/state'),
  search: (query) => request(`/api/search?q=${id(query)}&admin=1`),
  requestSong: (query) => post('/api/queue/request', { query, requestedBy: 'ControlPanel', admin: true }),
  removeFromQueue: (videoId) => del(`/api/queue/video/${id(videoId)}`),
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
  createTwitchReward: (data) => post('/api/integrations/twitch/rewards', data),
  updateTwitchReward: (rewardId, data) => patch(`/api/integrations/twitch/rewards/${id(rewardId)}`, data),
  disconnectTwitch: () => post('/api/integrations/twitch/disconnect'),
  getTwitchConfig: () => request('/api/integrations/twitch/config'),
  updateTwitchConfig: (config) => put('/api/integrations/twitch/config', config)
}
