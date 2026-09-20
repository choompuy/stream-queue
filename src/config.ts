import { CONFIG_PATH, createFileStore } from './persist.js'
import { Config } from './types.js'
import { isValidPlaylistId } from './youtube/url.js'

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

function cloneConfig(source: Config): Config {
  return { ...source, fallbackPlaylist: { ...source.fallbackPlaylist } }
}

export function getConfig(): Config {
  return cloneConfig(config)
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

export type FallbackPlaylistUpdates = Partial<Config['fallbackPlaylist']>
export type ConfigUpdates = Partial<Omit<Config, 'fallbackPlaylist'>> & { fallbackPlaylist?: FallbackPlaylistUpdates }
export type ConfigValidation = { clean: ConfigUpdates; rejected: string[] }

const FALLBACK_PLAYLIST_RULES: Record<keyof Config['fallbackPlaylist'], (value: unknown) => boolean> = {
  playlistId: (v) => v === null || isValidPlaylistId(v),
  enabled: (v) => typeof v === 'boolean',
  shuffle: (v) => typeof v === 'boolean',
  repeat: (v) => typeof v === 'boolean'
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function validateFallbackPlaylistUpdates(raw: unknown, rejected: string[]): FallbackPlaylistUpdates | undefined {
  if (!isPlainObject(raw)) {
    rejected.push('fallbackPlaylist')
    return undefined
  }

  const clean: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(raw)) {
    const rule = Object.hasOwn(FALLBACK_PLAYLIST_RULES, key) ? FALLBACK_PLAYLIST_RULES[key as keyof Config['fallbackPlaylist']] : undefined

    if (rule?.(value)) clean[key] = value
    else rejected.push(`fallbackPlaylist.${key}`)
  }

  return clean as FallbackPlaylistUpdates
}

/**
 * Pure validation of a config update: returns the part that is safe to apply and the names of everything
 * that was refused (invalid values, unknown fields, malformed nested objects). Nested names are dotted.
 */
export function validateConfigUpdates(updates: unknown): ConfigValidation {
  const clean: Record<string, unknown> = {}
  const rejected: string[] = []

  if (!isPlainObject(updates)) return { clean: {}, rejected: ['body'] }

  for (const [key, raw] of Object.entries(updates)) {
    if (key === 'fallbackPlaylist') {
      const nested = validateFallbackPlaylistUpdates(raw, rejected)
      if (nested) clean.fallbackPlaylist = nested
      continue
    }

    const rule = Object.hasOwn(FIELD_RULES, key) ? FIELD_RULES[key as keyof Config] : undefined
    if (!rule) {
      rejected.push(key)
      continue
    }

    const value = rule.normalize ? rule.normalize(raw) : raw
    if (rule.validate(value)) clean[key] = value
    else rejected.push(key)
  }

  return { clean: clean as ConfigUpdates, rejected }
}

/** Puts back a snapshot taken earlier (e.g. before an operation that failed half-way); bypasses validation on purpose. */
export function restoreConfig(snapshot: Config): void {
  config = cloneConfig(snapshot)
  saveConfig()
}

/** Applies the valid part of `updates` and reports what was refused; the caller decides whether that is an error. */
export function updateConfig(updates: ConfigUpdates): { config: Config; rejected: string[] } {
  const { clean, rejected } = validateConfigUpdates(updates)
  const { fallbackPlaylist, ...rest } = clean

  config = {
    ...config,
    ...rest,
    fallbackPlaylist: { ...config.fallbackPlaylist, ...fallbackPlaylist }
  }
  saveConfig()

  return { config: cloneConfig(config), rejected }
}
