import { createConfigModule, field, rules, type Schema } from '../../config-helper.js'
import { dataPath, deepMerge } from '../../persist.js'
import type { TwitchChatCommandConfig, TwitchChatPermission, TwitchConfig } from './types.js'

const COMMAND_PATTERN = /^![\p{L}\p{N}]+(?: [\p{L}\p{N}]+)*$/u
const PERMISSIONS: TwitchChatPermission[] = ['everyone', 'moderator', 'broadcaster']

export const CHAT_COMMAND_KEYS = ['now', 'queue', 'skip', 'pause', 'resume'] as const

const chatCommand = (command: string, permission: TwitchChatPermission): TwitchChatCommandConfig => ({ enabled: true, command, permission })

const commandSchema: Schema = {
  enabled: rules.boolean,
  command: field({
    normalize: (v) => (typeof v === 'string' ? v.trim().toLowerCase().replace(/\s+/g, ' ') : v),
    validate: (v) => typeof v === 'string' && COMMAND_PATTERN.test(v)
  }),
  permission: rules.oneOf(PERMISSIONS)
}

// `validateTwitchConfigUpdates` and `restoreTwitchConfig` are exported for tests
export const {
  getConfig: getTwitchConfig,
  updateConfig: updateTwitchConfig,
  validateConfigUpdates: validateTwitchConfigUpdates,
  restoreConfig: restoreTwitchConfig
} = createConfigModule<TwitchConfig>({
  filePath: () => dataPath('twitch-config.json'),
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
    channelPointsRewardId: field({
      normalize: (v) => (typeof v === 'string' ? v.trim() || null : v),
      validate: (v) => v === null || (typeof v === 'string' && v.length > 0)
    }),
    autoFulfillRedemptions: rules.boolean,
    chatCommands: {
      ...Object.fromEntries(CHAT_COMMAND_KEYS.map((key) => [key, commandSchema])),
      controlCooldownSeconds: rules.number(0, 300),
      plainCooldownSeconds: rules.number(0, 300)
    }
  },

  refine: (clean, current, reject) => {
    const updated = CHAT_COMMAND_KEYS.filter((key) => typeof clean.chatCommands?.[key]?.command === 'string')
    if (updated.length === 0) return

    // One pass over the changed commands: each is checked against the merged view (stored + this update),
    // so the final state must be collision-free - a mutual exchange lands in one step this way
    const merged = deepMerge(current.chatCommands, clean.chatCommands ?? {})
    const overlaps = (a: string, b: string) => a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `)
    const collides = (key: (typeof CHAT_COMMAND_KEYS)[number]) =>
      CHAT_COMMAND_KEYS.some((other) => other !== key && overlaps(merged[other].command, merged[key].command))

    for (const key of updated) {
      if (!collides(key)) continue
      delete clean.chatCommands?.[key]?.command
      reject(`chatCommands.${key}.command`)
    }
  }
})
