import { state } from './state.js'

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
