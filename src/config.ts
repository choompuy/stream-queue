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
  },
  twitch: {
    channelPointsRewardId: null
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
  return {
    ...source,
    fallbackPlaylist: { ...source.fallbackPlaylist },
    twitch: { ...source.twitch }
  }
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
export type TwitchConfigUpdates = Partial<Config['twitch']>

export type ConfigUpdates = Partial<Omit<Config, 'fallbackPlaylist' | 'twitch'>> & {
  fallbackPlaylist?: FallbackPlaylistUpdates
  twitch?: TwitchConfigUpdates
}

export type ConfigValidation = {
  clean: ConfigUpdates
  rejected: string[]
}

const FALLBACK_PLAYLIST_RULES: Record<keyof Config['fallbackPlaylist'], FieldRule> = {
  playlistId: {
    validate: (v) => v === null || isValidPlaylistId(v)
  },
  enabled: {
    validate: (v) => typeof v === 'boolean'
  },
  shuffle: {
    validate: (v) => typeof v === 'boolean'
  },
  repeat: {
    validate: (v) => typeof v === 'boolean'
  }
}

const TWITCH_RULES: Record<keyof Config['twitch'], FieldRule> = {
  channelPointsRewardId: {
    normalize: (v) => (typeof v === 'string' ? v.trim() || null : v),
    validate: (v) => v === null || (typeof v === 'string' && v.length > 0)
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function validateFallbackPlaylistUpdates(raw: unknown, rejected: string[]): FallbackPlaylistUpdates | undefined {
  if (!isPlainObject(raw)) {
    rejected.push('fallbackPlaylist')
    return undefined
  }

  const clean: Record<string, unknown> = {}

  for (const [key, rawValue] of Object.entries(raw)) {
    const rule = Object.hasOwn(FALLBACK_PLAYLIST_RULES, key) ? FALLBACK_PLAYLIST_RULES[key as keyof Config['fallbackPlaylist']] : undefined

    if (!rule) {
      rejected.push(`fallbackPlaylist.${key}`)
      continue
    }

    const value = rule.normalize ? rule.normalize(rawValue) : rawValue

    if (rule.validate(value)) clean[key] = value
    else rejected.push(`fallbackPlaylist.${key}`)
  }

  return clean as FallbackPlaylistUpdates
}

function validateTwitchUpdates(raw: unknown, rejected: string[]): TwitchConfigUpdates | undefined {
  if (!isPlainObject(raw)) {
    rejected.push('twitch')
    return undefined
  }

  const clean: Record<string, unknown> = {}

  for (const [key, rawValue] of Object.entries(raw)) {
    const rule = Object.hasOwn(TWITCH_RULES, key) ? TWITCH_RULES[key as keyof Config['twitch']] : undefined

    if (!rule) {
      rejected.push(`twitch.${key}`)
      continue
    }

    const value = rule.normalize ? rule.normalize(rawValue) : rawValue

    if (rule.validate(value)) clean[key] = value
    else rejected.push(`twitch.${key}`)
  }

  return clean as TwitchConfigUpdates
}

/**
 * Pure validation of a config update: returns the part that is safe to apply and the names of everything
 * that was refused (invalid values, unknown fields, malformed nested objects). Nested names are dotted.
 * `current` is the config the update would be merged onto - needed to check a field against another one
 * that isn't part of this particular update (e.g. changing only minDurationSeconds still has to make sense
 * next to the maxDurationSeconds already on file)
 */
export function validateConfigUpdates(updates: unknown, current: Config = config): ConfigValidation {
  const clean: Record<string, unknown> = {}
  const rejected: string[] = []

  if (!isPlainObject(updates)) return { clean: {}, rejected: ['body'] }

  for (const [key, raw] of Object.entries(updates)) {
    if (key === 'fallbackPlaylist') {
      const nested = validateFallbackPlaylistUpdates(raw, rejected)
      if (nested) clean.fallbackPlaylist = nested
      continue
    }

    if (key === 'twitch') {
      const nested = validateTwitchUpdates(raw, rejected)
      if (nested) clean.twitch = nested
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

  const minDuration = 'minDurationSeconds' in clean ? (clean.minDurationSeconds as number) : current.minDurationSeconds
  const maxDuration = 'maxDurationSeconds' in clean ? (clean.maxDurationSeconds as number) : current.maxDurationSeconds

  if (('minDurationSeconds' in clean || 'maxDurationSeconds' in clean) && minDuration >= maxDuration) {
    if ('minDurationSeconds' in clean) {
      rejected.push('minDurationSeconds')
      delete clean.minDurationSeconds
    }
    if ('maxDurationSeconds' in clean) {
      rejected.push('maxDurationSeconds')
      delete clean.maxDurationSeconds
    }
  }

  return {
    clean: clean as ConfigUpdates,
    rejected
  }
}

/** Puts back a snapshot taken earlier (e.g. before an operation that failed half-way); bypasses validation on purpose. */
export function restoreConfig(snapshot: Config): void {
  config = cloneConfig(snapshot)
  saveConfig()
}

/** Applies the valid part of `updates` and reports what was refused; the caller decides whether that is an error. */
export function updateConfig(updates: ConfigUpdates): { config: Config; rejected: string[] } {
  const { clean, rejected } = validateConfigUpdates(updates, config)
  const { fallbackPlaylist, twitch, ...rest } = clean

  config = {
    ...config,
    ...rest,
    fallbackPlaylist: { ...config.fallbackPlaylist, ...fallbackPlaylist },
    twitch: { ...config.twitch, ...twitch }
  }
  saveConfig()

  return {
    config: cloneConfig(config),
    rejected
  }
}
