// Tables that describe the inputs of the settings forms: `dom` names a key of the `dom` object (dom.js)

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
// <name>Enabled / <name>Command / <name>Permission, which are keys of `dom`.
export const CHAT_COMMAND_FIELDS = [
  { key: 'now', dom: 'chatCmdNow' },
  { key: 'queue', dom: 'chatCmdQueue' },
  { key: 'skip', dom: 'chatCmdSkip' },
  { key: 'pause', dom: 'chatCmdPause' },
  { key: 'resume', dom: 'chatCmdResume' }
]
