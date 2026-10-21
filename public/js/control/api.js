import { request as http, ApiError } from '../http.js'

export { ApiError }

// What the panel does after it changed something on the server: while the events are not open nothing else would tell it to read again
let afterChange = () => {}
export const onServerChange = (callback) => {
  afterChange = callback
}

async function request(url, options = {}, flags) {
  const data = await http(url, options, flags)
  if (options.method) afterChange()
  return data
}

const send = (method) => (url, body, flags) => request(url, { method, ...(body !== undefined && { body: JSON.stringify(body) }) }, flags)
const post = send('POST')
const put = send('PUT')
const patch = send('PATCH')
const del = send('DELETE')
const id = encodeURIComponent

export const api = {
  getSettings: () => request('/api/settings'),
  updateSettings: (settings) => put('/api/settings', settings, { partial: true }),

  getConfig: () => request('/api/config'),
  updateConfig: (config) => put('/api/config', config, { partial: true }),

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
  createTwitchReward: (data) => post('/api/integrations/twitch/rewards', data, { partial: true }),
  updateTwitchReward: (rewardId, data) => patch(`/api/integrations/twitch/rewards/${id(rewardId)}`, data, { partial: true }),
  disconnectTwitch: () => post('/api/integrations/twitch/disconnect'),
  getTwitchConfig: () => request('/api/integrations/twitch/config'),
  updateTwitchConfig: (config) => put('/api/integrations/twitch/config', config, { partial: true })
}
