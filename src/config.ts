import { createConfigModule, field, rules } from './config-helper.js'
import { dataPath } from './persist.js'
import { Config } from './types.js'
import { isValidPlaylistId, parsePlaylistId } from './youtube/url.js'

const MAX_MIN_VIEWS = 1_000_000_000
const MAX_DURATION_SECONDS = 24 * 60 * 60
const MAX_COUNT = 1000

// `validateConfigUpdates` is exported for tests: the routes validate through `updateConfig`
export const { getConfig, updateConfig, validateConfigUpdates, onConfigChange } = createConfigModule<Config>({
  filePath: () => dataPath('config.json'),
  topics: ['config'],
  defaults: {
    minViews: 10000,
    minDurationSeconds: 60,
    maxDurationSeconds: 480,
    maxQueueSize: 20,
    maxRequestsPerUser: 4,
    allowLiveStreams: false,
    contentMode: 'music',
    regionCode: '',
    fallbackPlaylist: { playlistId: null, enabled: true, shuffle: false, repeat: false }
  },
  schema: {
    minViews: rules.integer(0, MAX_MIN_VIEWS),
    minDurationSeconds: rules.integer(0, MAX_DURATION_SECONDS),
    maxDurationSeconds: rules.integer(1, MAX_DURATION_SECONDS),
    maxQueueSize: rules.integer(0, MAX_COUNT),
    maxRequestsPerUser: rules.integer(0, MAX_COUNT),
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
      // an id arrives as an id, a URL or an empty string that clears it; anything else is refused like any other field
      playlistId: field({
        normalize: (v) => {
          if (typeof v !== 'string') return v
          return parsePlaylistId(v) ?? (v.trim() ? v : null)
        },
        validate: (v) => v === null || isValidPlaylistId(v)
      }),
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
