export const state = {
  current: null,
  queue: [],
  isPaused: false,
  nextTrack: null,

  settings: {
    showVideo: true,
    hideOverlayInfo: false,
    opacity: 100,
    position: 'bottom-right'
  },

  config: null,
  fallback: null,
  playlists: [],
  network: null,
  selectedIp: null,
  activity: [],
  blocklist: [],

  twitch: {
    configured: false,
    connected: false,
    user: null,
    connectedAt: null,
    health: null,
    offlineWarning: false,
    authorization: null,
    rewards: [],
    selectedRewardId: '',
    config: null,
    editingReward: null
  }
}
