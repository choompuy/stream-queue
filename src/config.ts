import { CONFIG_PATH, createFileStore } from './persist.js'
import { Config, TwitchChatCommandConfig, TwitchChatCommandsConfig, TwitchChatPermission } from './types.js'
import { isValidPlaylistId } from './youtube/url.js'

type FieldRule = {
  normalize?: (value: unknown) => unknown
  validate: (value: unknown) => boolean
}

// Twitch chat commands are case-insensitive and always start with "!" - normalized so the chat
// dispatcher can do a plain string match against the incoming message. Allows one or more
// whitespace-separated words (e.g. "!sg skip"), not just a single bare "!word".
const COMMAND_WORD_PATTERN = /^![a-z0-9]+(?: [a-z0-9]+)*$/
const CHAT_PERMISSIONS: TwitchChatPermission[] = ['everyone', 'moderator', 'broadcaster']

function defaultChatCommand(command: string, permission: TwitchChatPermission): TwitchChatCommandConfig {
  return { enabled: true, command, permission }
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
    channelPointsRewardId: null,
    chatCommands: {
      now: defaultChatCommand('!sg now', 'everyone'),
      next: defaultChatCommand('!sg next', 'everyone'),
      skip: defaultChatCommand('!sg skip', 'moderator'),
      pause: defaultChatCommand('!sg pause', 'moderator'),
      resume: defaultChatCommand('!sg resume', 'moderator'),
      stop: defaultChatCommand('!sg stop', 'moderator'),
      controlCooldownSeconds: 5
    }
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
    twitch: {
      ...source.twitch,
      chatCommands: {
        ...source.twitch.chatCommands,
        now: { ...source.twitch.chatCommands.now },
        next: { ...source.twitch.chatCommands.next },
        skip: { ...source.twitch.chatCommands.skip },
        pause: { ...source.twitch.chatCommands.pause },
        resume: { ...source.twitch.chatCommands.resume },
        stop: { ...source.twitch.chatCommands.stop }
      }
    }
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
export type TwitchChatCommandUpdates = Partial<TwitchChatCommandConfig>
export type TwitchChatCommandsUpdates = Partial<Omit<TwitchChatCommandsConfig, 'controlCooldownSeconds'>> & {
  controlCooldownSeconds?: number
} & {
  [K in keyof Omit<TwitchChatCommandsConfig, 'controlCooldownSeconds'>]?: TwitchChatCommandUpdates
}
export type TwitchConfigUpdates = Partial<Omit<Config['twitch'], 'chatCommands'>> & {
  chatCommands?: TwitchChatCommandsUpdates
}

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

const TWITCH_RULES: Record<Exclude<keyof Config['twitch'], 'chatCommands'>, FieldRule> = {
  channelPointsRewardId: {
    normalize: (v) => (typeof v === 'string' ? v.trim() || null : v),
    validate: (v) => v === null || (typeof v === 'string' && v.length > 0)
  }
}

const CHAT_COMMAND_RULES: Record<keyof TwitchChatCommandConfig, FieldRule> = {
  enabled: {
    validate: (v) => typeof v === 'boolean'
  },
  command: {
    normalize: (v) => (typeof v === 'string' ? v.trim().toLowerCase().replace(/\s+/g, ' ') : v),
    validate: (v) => typeof v === 'string' && COMMAND_WORD_PATTERN.test(v)
  },
  permission: {
    validate: (v) => typeof v === 'string' && CHAT_PERMISSIONS.includes(v as TwitchChatPermission)
  }
}

const CHAT_COMMAND_KEYS: Array<keyof Omit<TwitchChatCommandsConfig, 'controlCooldownSeconds'>> = ['now', 'next', 'skip', 'pause', 'resume', 'stop']

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

function validateChatCommandUpdates(commandKey: string, raw: unknown, rejected: string[]): TwitchChatCommandUpdates | undefined {
  const path = `twitch.chatCommands.${commandKey}`

  if (!isPlainObject(raw)) {
    rejected.push(path)
    return undefined
  }

  const clean: Record<string, unknown> = {}

  for (const [key, rawValue] of Object.entries(raw)) {
    const rule = Object.hasOwn(CHAT_COMMAND_RULES, key) ? CHAT_COMMAND_RULES[key as keyof TwitchChatCommandConfig] : undefined

    if (!rule) {
      rejected.push(`${path}.${key}`)
      continue
    }

    const value = rule.normalize ? rule.normalize(rawValue) : rawValue

    if (rule.validate(value)) clean[key] = value
    else rejected.push(`${path}.${key}`)
  }

  return clean as TwitchChatCommandUpdates
}

function validateChatCommandsUpdates(raw: unknown, rejected: string[]): TwitchChatCommandsUpdates | undefined {
  if (!isPlainObject(raw)) {
    rejected.push('twitch.chatCommands')
    return undefined
  }

  const clean: Record<string, unknown> = {}

  for (const [key, rawValue] of Object.entries(raw)) {
    if ((CHAT_COMMAND_KEYS as string[]).includes(key)) {
      const nested = validateChatCommandUpdates(key, rawValue, rejected)
      if (nested) clean[key] = nested
      continue
    }

    if (key === 'controlCooldownSeconds') {
      const value = typeof rawValue === 'number' ? rawValue : rawValue
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 300) {
        clean[key] = value
      } else {
        rejected.push('twitch.chatCommands.controlCooldownSeconds')
      }
      continue
    }

    rejected.push(`twitch.chatCommands.${key}`)
  }

  return clean as TwitchChatCommandsUpdates
}

function validateTwitchUpdates(raw: unknown, rejected: string[]): TwitchConfigUpdates | undefined {
  if (!isPlainObject(raw)) {
    rejected.push('twitch')
    return undefined
  }

  const clean: Record<string, unknown> = {}

  for (const [key, rawValue] of Object.entries(raw)) {
    if (key === 'chatCommands') {
      const nested = validateChatCommandsUpdates(rawValue, rejected)
      if (nested) clean.chatCommands = nested
      continue
    }

    const rule = Object.hasOwn(TWITCH_RULES, key) ? TWITCH_RULES[key as keyof typeof TWITCH_RULES] : undefined

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

// Puts back a snapshot taken earlier (e.g. before an operation that failed half-way); bypasses validation on purpose
export function restoreConfig(snapshot: Config): void {
  config = cloneConfig(snapshot)
  saveConfig()
}

// Applies the valid part of `updates` and reports what was refused; the caller decides whether that is an error
export function updateConfig(updates: ConfigUpdates): { config: Config; rejected: string[] } {
  const { clean, rejected } = validateConfigUpdates(updates, config)
  const { fallbackPlaylist, twitch, ...rest } = clean
  const { chatCommands, ...twitchRest } = twitch ?? {}

  const mergedChatCommands = { ...config.twitch.chatCommands }
  if (chatCommands) {
    for (const key of CHAT_COMMAND_KEYS) {
      if (chatCommands[key]) mergedChatCommands[key] = { ...mergedChatCommands[key], ...chatCommands[key] }
    }
    if (chatCommands.controlCooldownSeconds !== undefined) {
      mergedChatCommands.controlCooldownSeconds = chatCommands.controlCooldownSeconds
    }
  }

  config = {
    ...config,
    ...rest,
    fallbackPlaylist: { ...config.fallbackPlaylist, ...fallbackPlaylist },
    twitch: {
      ...config.twitch,
      ...twitchRest,
      chatCommands: mergedChatCommands
    }
  }
  saveConfig()

  return {
    config: cloneConfig(config),
    rejected
  }
}
