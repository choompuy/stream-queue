import { createStore } from './store.js'

// What the panel knows. The slices the server owns (queue, config, fallback, …) are written by the reads of the
// watcher (index.js); the slices that are a choice of the person looking (selectedIp, selectedRewardId,
// editingReward) are written by the panel itself. Every slice is assigned whole, and whoever draws from one
// subscribes to it (store.on) instead of being called after every write.
export const store = createStore({
  // the state of the player and the queue
  current: null,
  queue: [],
  isPaused: false,
  nextTrack: null,

  // the rest of the server's data
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
  activity: [],
  blocklist: [],
  secrets: null,
  twitch: {
    configured: false,
    connected: false,
    user: null,
    connectedAt: null,
    health: null,
    offlineWarning: false,
    authorization: null,
    rewards: [],
    config: null,
    // a choice of the person looking, kept beside the rest of the Twitch slice because its drawings read it too
    selectedRewardId: '',
    editingReward: null
  },

  // the choice of the person looking
  selectedIp: null
})

export const state = store.state
export const on = store.on

// Whether this connection comes from the machine the app runs on. The server refuses its writes from anywhere else,
// so the panel hides them there. Unknown (the answer never arrived) counts as local: hiding working settings is worse
// than showing refused ones.
export function isLocalDevice() {
  return state.network?.isLocal !== false
}
