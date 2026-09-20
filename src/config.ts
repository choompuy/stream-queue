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

function sanitizeUpdates(updates: Partial<Config>): { clean: Partial<Config>; rejected: string[] } {
  const clean: Partial<Config> = { ...updates }
  const rejected: string[] = []

  for (const key of Object.keys(updates) as (keyof Config)[]) {
    const rule = FIELD_RULES[key]
    if (!rule) continue

    const value = rule.normalize ? rule.normalize(clean[key]) : clean[key]
    if (rule.validate(value)) {
      ;(clean as Record<string, unknown>)[key] = value
    } else {
      delete clean[key]
      rejected.push(key)
    }
  }

  return { clean, rejected }
}

function sanitizeFallbackPlaylist(
  updates: Partial<Config['fallbackPlaylist']> | undefined,
  current: Config['fallbackPlaylist']
): Config['fallbackPlaylist'] {
  if (!updates) return current

  const next = { ...current }

  if ('playlistId' in updates) {
    next.playlistId = typeof updates.playlistId === 'string' || updates.playlistId === null ? updates.playlistId : current.playlistId
  }
  if (typeof updates.enabled === 'boolean') next.enabled = updates.enabled
  if (typeof updates.shuffle === 'boolean') next.shuffle = updates.shuffle
  if (typeof updates.repeat === 'boolean') next.repeat = updates.repeat

  return next
}

export function updateConfig(updates: Partial<Config>): { config: Config; rejected: string[] } {
  const { clean, rejected } = sanitizeUpdates(updates)

  config = {
    ...config,
    ...clean,
    fallbackPlaylist: sanitizeFallbackPlaylist(updates.fallbackPlaylist, config.fallbackPlaylist)
  }
  saveConfig()
  return { config: { ...config }, rejected }
}
