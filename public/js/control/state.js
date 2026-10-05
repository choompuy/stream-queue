import { $, createLogger, setText } from '../shared.js'

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

export const dom = {
  showVideo: $('showVideo'),
  hideOverlayInfo: $('hideOverlayInfo'),
  overlayOpacity: $('overlayOpacity'),
  badgePosition: $('badgePosition'),
  overlayUrl: $('overlayUrl'),
  selectIp: $('selectIp'),
  controlPanelQr: $('controlPanelQr'),
  localeSelect: $('localeSelect'),

  cfgMinViews: $('cfgMinViews'),
  cfgMinDuration: $('cfgMinDuration'),
  cfgMaxDuration: $('cfgMaxDuration'),
  cfgMaxQueue: $('cfgMaxQueue'),
  cfgMaxPerUser: $('cfgMaxPerUser'),
  cfgContentMode: $('cfgContentMode'),
  cfgRegionCode: $('cfgRegionCode'),
  cfgAllowShorts: $('cfgAllowShorts'),
  cfgAllowLiveStreams: $('cfgAllowLiveStreams'),
  cfgSaveBtn: $('cfgSaveBtn'),

  secYoutubeKey: $('secYoutubeKey'),
  secretsStatus: $('secretsStatus'),

  nowPlaying: $('nowPlaying'),
  noPlaying: $('noPlaying'),
  currentTitle: $('currentTitle'),
  currentChannel: $('currentChannel'),
  currentDuration: $('currentDuration'),
  currentViews: $('currentViews'),
  currentRequester: $('currentRequester'),

  nextPlaying: $('nextPlaying'),
  nextTitle: $('nextTitle'),
  nextDuration: $('nextDuration'),

  playPauseBtn: $('playPauseBtn'),
  skipBtn: $('skipBtn'),
  clearQueueBtn: $('clearQueueBtn'),

  searchInput: $('searchInput'),
  searchListWrapper: $('searchListWrapper'),
  searchBtn: $('searchBtn'),

  sectionTabs: $('sectionTabs'),

  tabQueueCount: $('tabQueueCount'),
  queueListWrapper: $('queueListWrapper'),
  queueCount: $('queueCount'),

  tabPlaylistCount: $('tabPlaylistCount'),
  fallbackListWrapper: $('fallbackListWrapper'),
  fallbackInfo: $('fallbackInfo'),
  fallbackRefreshBtn: $('fallbackRefreshBtn'),
  fallbackRepeatBtn: $('fallbackRepeatBtn'),
  fallbackShuffleBtn: $('fallbackShuffleBtn'),
  fallbackEnabledBtn: $('fallbackEnabledBtn'),
  fallbackEnabledText: $('fallbackEnabledText'),

  tabActivityCount: $('tabActivityCount'),
  activityListWrapper: $('activityListWrapper'),
  clearActivityBtn: $('clearActivityBtn'),

  tabBlocklistCount: $('tabBlocklistCount'),
  blocklistListWrapper: $('blocklistListWrapper'),

  playlistsListWrapper: $('playlistsListWrapper'),
  playlistUrlInput: $('playlistUrlInput'),
  playlistAddBtn: $('playlistAddBtn'),

  twitchNotConfigured: $('twitchNotConfigured'),
  twitchConnectionControls: $('twitchConnectionControls'),
  twitchHealthWarning: $('twitchHealthWarning'),
  twitchAuthorization: $('twitchAuthorization'),
  twitchAuthorizationCode: $('twitchAuthorizationCode'),
  twitchChannelField: $('twitchChannelField'),
  twitchChanelImg: $('twitchChanelImg'),
  twitchChanelName: $('twitchChanelName'),
  twitchConnectBtn: $('twitchConnectBtn'),
  twitchDisconnectBtn: $('twitchDisconnectBtn'),
  twitchRewardSection: $('twitchRewardSection'),
  twitchRewardSelect: $('twitchRewardSelect'),
  twitchCreateNewRewardBtn: $('twitchCreateNewRewardBtn'),
  twitchAutoFulfillRedemptions: $('twitchAutoFulfillRedemptions'),
  twitchRewardForm: $('twitchRewardForm'),
  twitchRewardTitle: $('twitchRewardTitle'),
  twitchRewardCost: $('twitchRewardCost'),
  twitchRewardPrompt: $('twitchRewardPrompt'),
  twitchRewardBackgroundColor: $('twitchRewardBackgroundColor'),
  twitchRewardBackgroundColorPicker: $('twitchRewardBackgroundColorPicker'),
  twitchRewardEnabled: $('twitchRewardEnabled'),
  twitchMaxPerStreamEnabled: $('twitchMaxPerStreamEnabled'),
  twitchMaxPerStream: $('twitchMaxPerStream'),
  twitchMaxPerUserPerStreamEnabled: $('twitchMaxPerUserPerStreamEnabled'),
  twitchMaxPerUserPerStream: $('twitchMaxPerUserPerStream'),
  twitchGlobalCooldownEnabled: $('twitchGlobalCooldownEnabled'),
  twitchGlobalCooldownSeconds: $('twitchGlobalCooldownSeconds'),
  twitchSaveRewardBtn: $('twitchSaveRewardBtn'),

  twitchChatCommandsPanel: $('twitchChatCommandsPanel'),
  chatCmdCooldown: $('chatCmdCooldown'),
  chatCmdPlainCooldown: $('chatCmdPlainCooldown'),
  chatCmdNowEnabled: $('chatCmdNowEnabled'),
  chatCmdNowCommand: $('chatCmdNowCommand'),
  chatCmdNowPermission: $('chatCmdNowPermission'),
  chatCmdQueueEnabled: $('chatCmdQueueEnabled'),
  chatCmdQueueCommand: $('chatCmdQueueCommand'),
  chatCmdQueuePermission: $('chatCmdQueuePermission'),
  chatCmdSkipEnabled: $('chatCmdSkipEnabled'),
  chatCmdSkipCommand: $('chatCmdSkipCommand'),
  chatCmdSkipPermission: $('chatCmdSkipPermission'),
  chatCmdPauseEnabled: $('chatCmdPauseEnabled'),
  chatCmdPauseCommand: $('chatCmdPauseCommand'),
  chatCmdPausePermission: $('chatCmdPausePermission'),
  chatCmdResumeEnabled: $('chatCmdResumeEnabled'),
  chatCmdResumeCommand: $('chatCmdResumeCommand'),
  chatCmdResumePermission: $('chatCmdResumePermission'),
  twitchChatCommandsSaveBtn: $('twitchChatCommandsSaveBtn')
}

export const CONFIG_FIELDS = [
  { key: 'minViews', dom: 'cfgMinViews', type: 'number' },
  { key: 'minDurationSeconds', dom: 'cfgMinDuration', type: 'number' },
  { key: 'maxDurationSeconds', dom: 'cfgMaxDuration', type: 'number' },
  { key: 'maxQueueSize', dom: 'cfgMaxQueue', type: 'number' },
  { key: 'maxRequestsPerUser', dom: 'cfgMaxPerUser', type: 'number' },
  { key: 'regionCode', dom: 'cfgRegionCode', type: 'text' },
  { key: 'allowShorts', dom: 'cfgAllowShorts', type: 'checkbox' },
  { key: 'allowLiveStreams', dom: 'cfgAllowLiveStreams', type: 'checkbox' },
  { key: 'contentMode', dom: 'cfgContentMode', type: 'text' }
]

// Each Twitch chat command has three sub-fields (enabled/command/permission), rendered from
// <name>Enabled / <name>Command / <name>Permission DOM ids built from `dom` below.
export const CHAT_COMMAND_FIELDS = [
  { key: 'now', dom: 'chatCmdNow' },
  { key: 'queue', dom: 'chatCmdQueue' },
  { key: 'skip', dom: 'chatCmdSkip' },
  { key: 'pause', dom: 'chatCmdPause' },
  { key: 'resume', dom: 'chatCmdResume' }
]

export const selectors = {
  blockedIds: () => new Set(state.blocklist.map((entry) => entry.videoId)),

  markBlocked(items) {
    const blocked = selectors.blockedIds()
    return items.map((item) => ({ ...item, isBlocked: blocked.has(item.videoId) }))
  }
}

export function renderStats() {
  setText(dom.tabPlaylistCount, state.fallback?.sourceCount ?? 0)
  setText(dom.tabActivityCount, state.activity.length)
  setText(dom.tabBlocklistCount, state.blocklist.length)
}
