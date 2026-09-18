import { CONFIG_PATH, createFileStore } from './persist.js'
import { Config } from './types.js'

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

const NUMERIC_FIELDS: { key: keyof Config; min: number }[] = [
  { key: 'minViews', min: 0 },
  { key: 'minDurationSeconds', min: 0 },
  { key: 'maxDurationSeconds', min: 1 },
  { key: 'maxQueueSize', min: 1 },
  { key: 'maxRequestsPerUser', min: 0 }
]

function sanitizeNumericUpdates(updates: Partial<Config>): Partial<Config> {
  const clean: Partial<Config> = { ...updates }

  for (const { key, min } of NUMERIC_FIELDS) {
    const value = updates[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
      delete clean[key]
    }
  }

  return clean
}

const REGION_CODE_PATTERN = /^[A-Z]{2}$/
const BOOLEAN_FIELDS: (keyof Config)[] = ['allowShorts', 'allowLiveStreams']

function sanitizeBooleanUpdates(updates: Partial<Config>): Partial<Config> {
  const clean: Partial<Config> = { ...updates }
  for (const key of BOOLEAN_FIELDS) {
    if (key in updates && typeof updates[key] !== 'boolean') delete clean[key]
  }
  return clean
}

function sanitizeRegionCode(updates: Partial<Config>): Partial<Config> {
  const clean: Partial<Config> = { ...updates }

  if ('regionCode' in updates) {
    const raw = updates.regionCode
    const normalized = typeof raw === 'string' ? raw.trim().toUpperCase() : ''

    if (normalized === '') {
      clean.regionCode = ''
    } else if (REGION_CODE_PATTERN.test(normalized)) {
      clean.regionCode = normalized
    } else {
      delete clean.regionCode
    }
  }

  return clean
}

export function updateConfig(updates: Partial<Config>): Config {
  const safeUpdates = { ...sanitizeNumericUpdates(updates), ...sanitizeRegionCode(updates), ...sanitizeBooleanUpdates(updates) }

  config = {
    ...config,
    ...safeUpdates,
    fallbackPlaylist: { ...config.fallbackPlaylist, ...updates.fallbackPlaylist }
  }
  saveConfig()
  return { ...config }
}
