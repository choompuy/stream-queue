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
  activity: []
}

export const dom = {
  showVideo: $('showVideo'),
  badgePosition: $('badgePosition'),
  previewUrl: $('previewUrl'),
  selectIp: $('selectIp'),
  controlPanelQr: $('controlPanelQr'),

  cfgMinViews: $('cfgMinViews'),
  cfgMinDuration: $('cfgMinDuration'),
  cfgMaxDuration: $('cfgMaxDuration'),
  cfgMaxQueue: $('cfgMaxQueue'),
  cfgMaxPerUser: $('cfgMaxPerUser'),

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
  searchError: $('searchError'),
  searchBtn: $('searchBtn'),

  statQueueLength: $('statQueueLength'),
  statAcceptedToday: $('statAcceptedToday'),
  statRejectedToday: $('statRejectedToday'),
  statFallbackCount: $('statFallbackCount'),

  sectionTabs: $('sectionTabs'),
  tabQueueCount: $('tabQueueCount'),
  tabJamCount: $('tabJamCount'),
  tabRecentCount: $('tabRecentCount'),

  queueListWrapper: $('queueListWrapper'),
  queueCount: $('queueCount'),

  fallbackListWrapper: $('fallbackListWrapper'),
  fallbackInfo: $('fallbackInfo'),
  fallbackRefreshBtn: $('fallbackRefreshBtn'),
  fallbackRepeatBtn: $('fallbackRepeatBtn'),
  fallbackShuffleBtn: $('fallbackShuffleBtn'),
  fallbackEnabledBtn: $('fallbackEnabledBtn'),
  fallbackEnabledText: $('fallbackEnabledText'),

  activityListWrapper: $('activityListWrapper'),
  clearActivityBtn: $('clearActivityBtn'),

  playlistsListWrapper: $('playlistsListWrapper'),
  playlistUrlInput: $('playlistUrlInput'),
  playlistAddBtn: $('playlistAddBtn'),
  playlistsCount: $('playlistsCount'),
  playlistError: $('playlistError')
}

export const views = createViews(dom)

export const CONFIG_FIELDS = [
  { key: 'minViews', dom: 'cfgMinViews', type: 'number' },
  { key: 'minDurationSeconds', dom: 'cfgMinDuration', type: 'number' },
  { key: 'maxDurationSeconds', dom: 'cfgMaxDuration', type: 'number' },
  { key: 'maxQueueSize', dom: 'cfgMaxQueue', type: 'number' },
  { key: 'maxRequestsPerUser', dom: 'cfgMaxPerUser', type: 'number' }
]

export function renderStats() {
  if (dom.tabJamCount) dom.tabJamCount.textContent = state.fallback?.sourceCount ?? 0
  if (dom.tabRecentCount) dom.tabRecentCount.textContent = state.activity.length
}
