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
  activityFilter: 'all',
  blocklist: [],

  twitch: {
    configured: false,
    connected: false,
    user: null,
    connectedAt: null,
    health: null,
    offlineWarning: false,
    rewards: [],
    selectedRewardId: '',
    savedRewardId: '',
    chatCommands: null,
    editingReward: null,
    savedAutoFulfillRedemptions: false
  }
}

export const selectors = {
  blockedIds: () => new Set(state.blocklist.map((entry) => entry.videoId)),

  markBlocked(items) {
    const blocked = selectors.blockedIds()
    return items.map((item) => ({ ...item, isBlocked: blocked.has(item.videoId) }))
  }
}
