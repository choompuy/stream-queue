import { createLogger } from '../shared.js'

export const log = createLogger('CONTROL')

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
    unhealthyPolls: 0,
    rewards: [],
    selectedRewardId: '',
    savedRewardId: '',
    chatCommands: null,
    editingReward: null,
    savedAutoFulfillRedemptions: false
  }
}
