import type { TwitchChatMessage, TwitchChatPermission } from './types.js'
import { replyInChat } from './chat-reply.js'
import {
  buildNowPlayingMessage,
  buildQueueMessage,
  buildSkipMessage
} from '../../chat-replies.js'
import { getTwitchConfig, CHAT_COMMAND_KEYS } from './config.js'
import { getState, skipCurrent, setPaused } from '../../player.js'
import { getSettings } from '../../settings.js'
import { t } from '../../i18n.js'
import { createLogger } from '../../logger.js'

// Chat commands of the queue: matching, permissions, cooldowns and the replies. The chat socket
// belongs to the lifecycle in index.ts, and sending through it to chat-reply.ts; this module
// only decides what a message triggers and what the answer says.

const chatLog = createLogger('TWITCH CHAT')

/** Answers whether the sender of the message may use a command with this permission level. */
export function hasPermission(message: TwitchChatMessage, permission: TwitchChatPermission): boolean {
  switch (permission) {
    case 'everyone':
      return true
    case 'moderator':
      return message.isModerator || message.isBroadcaster
    case 'broadcaster':
      return message.isBroadcaster
  }
}

// A command word must be the whole message (or the first word, for forward-compatibility with arguments),
// case-insensitive - "!sg skip" matches "!sg skip", "!SG SKIP", and "!sg skip please"
// but not "!sg skipping" or a message that merely contains it midway through
/** Matches a message against a command word: whole-message or first-word, case-insensitive. */
export function matchesCommand(text: string, command: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ')
  return normalized === command || normalized.startsWith(`${command} `)
}

// One global (not per-user) cooldown per kind of command: two moderators can't double up on skip/pause/resume,
// and now/queue can't be spammed
const lastRun = { plainCooldownSeconds: 0, controlCooldownSeconds: 0 }

async function runCommand(message: TwitchChatMessage, cooldown: keyof typeof lastRun, cooldownSeconds: number, action: () => string): Promise<void> {
  const now = Date.now()
  if (now - lastRun[cooldown] < cooldownSeconds * 1000) {
    chatLog.info(`Ignored a command from ${message.displayName}: cooldown active`)
    return
  }
  lastRun[cooldown] = now

  await replyInChat(action())
}

const COMMANDS: Record<(typeof CHAT_COMMAND_KEYS)[number], { cooldown: keyof typeof lastRun; run: () => string }> = {
  now: {
    cooldown: 'plainCooldownSeconds',
    run: () => buildNowPlayingMessage(getState(), getSettings().locale)
  },
  queue: {
    cooldown: 'plainCooldownSeconds',
    run: () => buildQueueMessage(getState(), getSettings().locale)
  },
  skip: {
    cooldown: 'controlCooldownSeconds',
    run: () => {
      skipCurrent()
      return buildSkipMessage(getState(), getSettings().locale)
    }
  },
  pause: {
    cooldown: 'controlCooldownSeconds',
    run: () => {
      setPaused(true)
      return t(getSettings().locale, 'chat.paused')
    }
  },
  resume: {
    cooldown: 'controlCooldownSeconds',
    run: () => {
      setPaused(false)
      return t(getSettings().locale, 'chat.resumed')
    }
  }
}

/** Handles one channel message: the first enabled, matching and permitted command runs, anything else returns. */
export async function handleChatMessage(message: TwitchChatMessage): Promise<void> {
  // every command starts with "!" (the config schema enforces the prefix): any other channel talk
  // is over before it could cost a config read or a command comparison
  if (!message.text.startsWith('!')) return

  const commands = getTwitchConfig().chatCommands

  for (const key of CHAT_COMMAND_KEYS) {
    const { enabled, command, permission } = commands[key]
    if (!enabled || !matchesCommand(message.text, command) || !hasPermission(message, permission)) continue

    chatLog.info(`Command "${command}" from ${message.displayName}`)
    const { cooldown, run } = COMMANDS[key]
    await runCommand(message, cooldown, commands[cooldown], run)
    return
  }
}

/** Clears the command cooldowns: stop() resets them when the integration is torn down. */
export function resetCommandCooldowns(): void {
  lastRun.plainCooldownSeconds = lastRun.controlCooldownSeconds = 0
}
