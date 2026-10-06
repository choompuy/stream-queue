import { createConfigModule, field, rules } from '../infra/config-helper.js'
import { dataPath } from '../infra/persist.js'
import { Config } from './types.js'
import { isValidPlaylistId } from '../integrations/youtube/url.js'

const MAX_MIN_VIEWS = 1_000_000_000
const MAX_DURATION_SECONDS = 24 * 60 * 60
const MAX_COUNT = 1000

export const { getConfig, updateConfig, validateConfigUpdates, restoreConfig } = createConfigModule<Config>({
  filePath: () => dataPath('config.json'),
  defaults: {
    minViews: 10000,
    minDurationSeconds: 60,
    maxDurationSeconds: 480,
    maxQueueSize: 20,
    maxRequestsPerUser: 4,
    allowShorts: false,
    allowLiveStreams: false,
    contentMode: 'music',
    regionCode: '',
    fallbackPlaylist: { playlistId: null, enabled: true, shuffle: false, repeat: false }
  },
  schema: {
    minViews: rules.integer(0, MAX_MIN_VIEWS),
    minDurationSeconds: rules.integer(0, MAX_DURATION_SECONDS),
    maxDurationSeconds: rules.integer(1, MAX_DURATION_SECONDS),
    maxQueueSize: rules.integer(1, MAX_COUNT),
    maxRequestsPerUser: rules.integer(0, MAX_COUNT),
    allowShorts: rules.boolean,
    allowLiveStreams: rules.boolean,
    contentMode: field({
      normalize: (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
      validate: (v) => v === 'music' || v === 'any'
    }),
    regionCode: field({
      normalize: (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v),
      validate: (v) => v === '' || (typeof v === 'string' && /^[A-Z]{2}$/.test(v))
    }),
    fallbackPlaylist: {
      playlistId: field({ validate: (v) => v === null || isValidPlaylistId(v) }),
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
