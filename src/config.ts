import { CONFIG_PATH, createFileStore } from './persist.js'
import { Config } from './types.js'

type FieldRule = {
  normalize?: (value: unknown) => unknown
  validate: (value: unknown) => boolean
}

const configDefaults: Config = {
  minViews: 10000,
  minDurationSeconds: 60,
  maxDurationSeconds: 480,
  maxQueueSize: 20,
  maxRequestsPerUser: 4,
  regionCode: '',
  allowShorts: false,
  allowLiveStreams: false,
  fallbackPlaylist: {
    playlistId: null,
    enabled: true,
    shuffle: false,
    repeat: false
  }
}

const store = createFileStore<Config>(CONFIG_PATH)
let config: Config = store.load(configDefaults)

function saveConfig(): void {
  store.scheduleSave(
    () => config,
    (error) => console.error('[CONFIG] Failed to save config:', error instanceof Error ? error.message : error)
  )
}

export function getConfig(): Config {
  return { ...config }
}

const FIELD_RULES: Partial<Record<keyof Config, FieldRule>> = {
  minViews: {
    validate: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0
  },
  minDurationSeconds: {
    validate: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0
  },
  maxDurationSeconds: {
    validate: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 1
  },
  maxQueueSize: {
    validate: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 1
  },
  maxRequestsPerUser: {
    validate: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0
  },
  regionCode: {
    normalize: (v) => (typeof v === 'string' ? v.trim().toUpperCase() : ''),
    validate: (v) => v === '' || /^[A-Z]{2}$/.test(v as string)
  },
  allowShorts: {
    validate: (v) => typeof v === 'boolean'
  },
  allowLiveStreams: {
    validate: (v) => typeof v === 'boolean'
  }
}

function sanitizeUpdates(updates: Partial<Config>): Partial<Config> {
  const clean: Partial<Config> = { ...updates }

  for (const key of Object.keys(updates) as (keyof Config)[]) {
    const rule = FIELD_RULES[key]
    if (!rule) continue

    const value = rule.normalize ? rule.normalize(clean[key]) : clean[key]
    if (rule.validate(value)) (clean as Record<string, unknown>)[key] = value
    else delete clean[key]
  }

  return clean
}

export function updateConfig(updates: Partial<Config>): Config {
  const safeUpdates = { ...sanitizeUpdates(updates) }

  config = {
    ...config,
    ...safeUpdates,
    fallbackPlaylist: { ...config.fallbackPlaylist, ...updates.fallbackPlaylist }
  }
  saveConfig()
  return { ...config }
}
