import { DATA_DIR } from '../../persist.js'
import { createConfigModule, type FieldRule } from '../../config-helper.js'
import {
  TwitchChatCommandConfig,
  TwitchChatCommandsConfig,
  TwitchChatCommandsUpdates,
  TwitchChatCommandUpdates,
  TwitchChatPermission,
  TwitchConfig,
  TwitchConfigUpdates
} from './types.js'

const COMMAND_WORD_PATTERN = /^![a-z0-9]+(?: [a-z0-9]+)*$/
const CHAT_PERMISSIONS: TwitchChatPermission[] = ['everyone', 'moderator', 'broadcaster']

function defaultChatCommand(command: string, permission: TwitchChatPermission): TwitchChatCommandConfig {
  return { enabled: true, command, permission }
}

const twitchConfigDefaults: TwitchConfig = {
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

export const CHAT_COMMAND_KEYS: Array<keyof Omit<TwitchChatCommandsConfig, 'controlCooldownSeconds'>> = [
  'now',
  'next',
  'skip',
  'pause',
  'resume',
  'stop'
]

const TWITCH_CONFIG_RULES: Record<keyof TwitchConfig, FieldRule> = {
  channelPointsRewardId: {
    normalize: (v: unknown) => (typeof v === 'string' ? v.trim() || null : v),
    validate: (v: unknown) => v === null || (typeof v === 'string' && v.length > 0)
  },
  chatCommands: {
    normalize: (v: unknown) => v,
    validate: (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v)
  }
}

const CHAT_COMMAND_RULES: Record<keyof TwitchChatCommandConfig, FieldRule> = {
  enabled: {
    validate: (v: unknown) => typeof v === 'boolean'
  },
  command: {
    normalize: (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase().replace(/\s+/g, ' ') : v),
    validate: (v: unknown) => typeof v === 'string' && COMMAND_WORD_PATTERN.test(v)
  },
  permission: {
    validate: (v: unknown) => typeof v === 'string' && CHAT_PERMISSIONS.includes(v as TwitchChatPermission)
  }
}

function cloneTwitchConfig(source: TwitchConfig): TwitchConfig {
  // Deep clone using JSON.stringify/parse
  return JSON.parse(JSON.stringify(source)) as TwitchConfig
}

const {
  getConfig,
  updateConfig: updateConfigModule,
  validateConfigUpdates,
  restoreConfig
} = createConfigModule<TwitchConfig>({
  filePath: `${DATA_DIR}/twitch-config.json`,
  defaults: twitchConfigDefaults,
  rules: TWITCH_CONFIG_RULES,
  clone: cloneTwitchConfig
})

function validateChatCommandUpdates(commandKey: string, raw: unknown, rejected: string[]): TwitchChatCommandUpdates | undefined {
  const path = `chatCommands.${commandKey}`

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
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
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    rejected.push('chatCommands')
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
      if (typeof rawValue === 'number' && Number.isFinite(rawValue) && rawValue >= 0 && rawValue <= 300) {
        clean[key] = rawValue
      } else {
        rejected.push('chatCommands.controlCooldownSeconds')
      }
      continue
    }

    rejected.push(`chatCommands.${key}`)
  }

  return clean as TwitchChatCommandsUpdates
}

export function validateTwitchConfigUpdates(updates: unknown): { clean: TwitchConfigUpdates; rejected: string[] } {
  const clean: Record<string, unknown> = {}
  const rejected: string[] = []

  if (typeof updates !== 'object' || updates === null || Array.isArray(updates)) {
    return { clean: {}, rejected: ['body'] }
  }

  for (const [key, raw] of Object.entries(updates)) {
    if (key === 'chatCommands') {
      const nested = validateChatCommandsUpdates(raw, rejected)
      if (nested) clean.chatCommands = nested
      continue
    }

    const rule = Object.hasOwn(TWITCH_CONFIG_RULES, key) ? TWITCH_CONFIG_RULES[key as keyof TwitchConfig] : undefined
    if (!rule) {
      rejected.push(key)
      continue
    }

    const value = rule.normalize ? rule.normalize(raw) : raw
    if (rule.validate(value)) clean[key] = value
    else rejected.push(key)
  }

  return { clean: clean as TwitchConfigUpdates, rejected }
}

export function updateTwitchConfig(updates: TwitchConfigUpdates): { config: TwitchConfig; rejected: string[] } {
  const { clean, rejected } = validateTwitchConfigUpdates(updates)
  const { chatCommands, ...rest } = clean

  const current = getConfig()
  const mergedChatCommands = { ...current.chatCommands }

  if (chatCommands) {
    for (const key of CHAT_COMMAND_KEYS) {
      if (chatCommands[key]) mergedChatCommands[key] = { ...mergedChatCommands[key], ...chatCommands[key] }
    }
    if (chatCommands.controlCooldownSeconds !== undefined) {
      mergedChatCommands.controlCooldownSeconds = chatCommands.controlCooldownSeconds
    }
  }

  const finalConfig: TwitchConfig = {
    ...current,
    ...rest,
    chatCommands: mergedChatCommands
  }

  // Use the updateConfigModule to save the config
  updateConfigModule(finalConfig)

  // Return a cloned copy
  return {
    config: cloneTwitchConfig(getConfig()),
    rejected
  }
}

export { getConfig as getTwitchConfig, restoreConfig as restoreTwitchConfig, updateConfigModule as _updateConfigModule, cloneTwitchConfig }
