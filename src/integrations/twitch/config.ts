import { join } from 'node:path'
import { createConfigModule, rules, type Schema } from '../../config-helper.js'
import { DATA_DIR, deepMerge } from '../../persist.js'
import type { TwitchChatCommandConfig, TwitchChatPermission, TwitchConfig } from './types.js'

const COMMAND_PATTERN = /^![a-z0-9]+(?: [a-z0-9]+)*$/
const PERMISSIONS: TwitchChatPermission[] = ['everyone', 'moderator', 'broadcaster']

export const CHAT_COMMAND_KEYS = ['now', 'queue', 'skip', 'pause', 'resume'] as const

const chatCommand = (command: string, permission: TwitchChatPermission): TwitchChatCommandConfig => ({ enabled: true, command, permission })

const commandSchema: Schema = {
  enabled: rules.boolean,
  command: {
    normalize: (v) => (typeof v === 'string' ? v.trim().toLowerCase().replace(/\s+/g, ' ') : v),
    validate: (v) => typeof v === 'string' && COMMAND_PATTERN.test(v)
  },
  permission: { validate: (v) => PERMISSIONS.includes(v as TwitchChatPermission) }
}

export const {
  getConfig: getTwitchConfig,
  updateConfig: updateTwitchConfig,
  validateConfigUpdates: validateTwitchConfigUpdates,
  restoreConfig: restoreTwitchConfig
} = createConfigModule<TwitchConfig>({
  filePath: join(DATA_DIR, 'twitch-config.json'),
  defaults: {
    channelPointsRewardId: null,
    autoFulfillRedemptions: false,
    chatCommands: {
      now: chatCommand('!sg now', 'everyone'),
      queue: chatCommand('!sg queue', 'everyone'),
      skip: chatCommand('!sg skip', 'moderator'),
      pause: chatCommand('!sg pause', 'moderator'),
      resume: chatCommand('!sg resume', 'moderator'),
      controlCooldownSeconds: 5,
      plainCooldownSeconds: 5
    }
  },
  schema: {
    channelPointsRewardId: {
      normalize: (v) => (typeof v === 'string' ? v.trim() || null : v),
      validate: (v) => v === null || (typeof v === 'string' && v.length > 0)
    },
    autoFulfillRedemptions: rules.boolean,
    chatCommands: {
      ...Object.fromEntries(CHAT_COMMAND_KEYS.map((key) => [key, commandSchema])),
      controlCooldownSeconds: rules.number(0, 300),
      plainCooldownSeconds: rules.number(0, 300)
    }
  },

  refine: (clean, current, reject) => {
    if (!clean.chatCommands) return

    const stored = current.chatCommands
    const merged = deepMerge(stored, clean.chatCommands)
    const collides = (key: (typeof CHAT_COMMAND_KEYS)[number]) =>
      CHAT_COMMAND_KEYS.some((other) => other !== key && merged[other].command === merged[key].command)

    for (let pass = 0; pass < CHAT_COMMAND_KEYS.length; pass++) {
      const conflicting = CHAT_COMMAND_KEYS.filter((key) => collides(key) && merged[key].command !== stored[key].command)
      if (conflicting.length === 0) return

      for (const key of conflicting) {
        merged[key] = { ...merged[key], command: stored[key].command }
        delete clean.chatCommands[key]?.command
        reject(`chatCommands.${key}.command`)
      }
    }
  }
})
