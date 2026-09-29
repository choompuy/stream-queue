import { createConfigModule, rules } from './config-helper.js'
import { CONFIG_PATH } from './persist.js'
import { Config } from './types.js'
import { isValidPlaylistId } from './youtube/url.js'

export const { getConfig, updateConfig, validateConfigUpdates, restoreConfig } = createConfigModule<Config>({
  filePath: CONFIG_PATH,
  defaults: {
    minViews: 10000,
    minDurationSeconds: 60,
    maxDurationSeconds: 480,
    maxQueueSize: 20,
    maxRequestsPerUser: 4,
    regionCode: '',
    allowShorts: false,
    allowLiveStreams: false,
    fallbackPlaylist: { playlistId: null, enabled: true, shuffle: false, repeat: false }
  },
  schema: {
    minViews: rules.number(0),
    minDurationSeconds: rules.number(0),
    maxDurationSeconds: rules.number(1),
    maxQueueSize: rules.number(1),
    maxRequestsPerUser: rules.number(0),
    regionCode: {
      normalize: (v) => (typeof v === 'string' ? v.trim().toUpperCase() : ''),
      validate: (v) => v === '' || /^[A-Z]{2}$/.test(v as string)
    },
    allowShorts: rules.boolean,
    allowLiveStreams: rules.boolean,
    fallbackPlaylist: {
      playlistId: { validate: (v) => v === null || isValidPlaylistId(v) },
      enabled: rules.boolean,
      shuffle: rules.boolean,
      repeat: rules.boolean
    }
  },

  refine: (clean, current, reject) => {
    const min = clean.minDurationSeconds ?? current.minDurationSeconds
    const max = clean.maxDurationSeconds ?? current.maxDurationSeconds
    if (min < max) return

    for (const key of ['minDurationSeconds', 'maxDurationSeconds'] as const) {
      if (key in clean) {
        delete clean[key]
        reject(key)
      }
    }
  }
})
