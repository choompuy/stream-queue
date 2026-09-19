import { $, createLogger } from '../shared.js'
import { createViews } from './views.js'

export const log = createLogger('CONTROL')

export const state = {
  current: null,
  queue: [],
  isPaused: false,
  nextTrack: null,

  settings: {
    showVideo: true,
    position: 'bottom-right'
  },

  config: null,
  fallback: null,
  playlists: [],
  network: null,
  selectedIp: null,
  activity: [],
  activityFilter: 'all',
  blocklist: []
}

export const dom = {
  showVideo: $('showVideo'),
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
  cfgRegionCode: $('cfgRegionCode'),
  cfgAllowShorts: $('cfgAllowShorts'),
  cfgAllowLiveStreams: $('cfgAllowLiveStreams'),

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
  statAcceptedToday: $('statAcceptedToday'),
  statRejectedToday: $('statRejectedToday'),
  activityListWrapper: $('activityListWrapper'),
  clearActivityBtn: $('clearActivityBtn'),
  activityFilterAllBtn: $('activityFilterAllBtn'),
  activityFilterAcceptedBtn: $('activityFilterAcceptedBtn'),
  activityFilterRejectedBtn: $('activityFilterRejectedBtn'),

  tabBlocklistCount: $('tabBlocklistCount'),
  blocklistListWrapper: $('blocklistListWrapper'),

  playlistsListWrapper: $('playlistsListWrapper'),
  playlistUrlInput: $('playlistUrlInput'),
  playlistAddBtn: $('playlistAddBtn'),
  playlistsCount: $('playlistsCount')
}

export const views = createViews(dom)

export const CONFIG_FIELDS = [
  { key: 'minViews', dom: 'cfgMinViews', type: 'number' },
  { key: 'minDurationSeconds', dom: 'cfgMinDuration', type: 'number' },
  { key: 'maxDurationSeconds', dom: 'cfgMaxDuration', type: 'number' },
  { key: 'maxQueueSize', dom: 'cfgMaxQueue', type: 'number' },
  { key: 'maxRequestsPerUser', dom: 'cfgMaxPerUser', type: 'number' },
  { key: 'regionCode', dom: 'cfgRegionCode', type: 'text' },
  { key: 'allowShorts', dom: 'cfgAllowShorts', type: 'checkbox' },
  { key: 'allowLiveStreams', dom: 'cfgAllowLiveStreams', type: 'checkbox' }
]

export function renderStats() {
  if (dom.tabPlaylistCount) dom.tabPlaylistCount.textContent = state.fallback?.sourceCount ?? 0
  if (dom.tabActivityCount) dom.tabActivityCount.textContent = state.activity.length
  if (dom.tabBlocklistCount) dom.tabBlocklistCount.textContent = state.blocklist.length
}
