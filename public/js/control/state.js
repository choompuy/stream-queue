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

// Whether this connection comes from the machine the app runs on. The server refuses its writes from anywhere else,
// so the panel hides them there. Unknown (the answer never arrived) counts as local: hiding working settings is worse
// than showing refused ones.
export function isLocalDevice() {
  return state.network?.isLocal !== false
}
