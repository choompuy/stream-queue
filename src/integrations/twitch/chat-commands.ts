import { setTimeout as sleep } from 'node:timers/promises'
import type { TwitchChatMessage, TwitchChatPermission } from './types.js'
import { chatConnection } from './state.js'
import {
  buildNowPlayingMessage,
  buildQueueMessage,
  buildSkipMessage
} from '../../chat-replies.js'
import { getTwitchConfig, CHAT_COMMAND_KEYS } from './config.js'
import { getState, skipCurrent, setPaused } from '../../player.js'
import { getSettings } from '../../settings.js'
import { t } from '../../i18n.js'
import { createLogger, describeError } from '../../logger.js'

// Chat commands of the queue: matching, permissions, cooldowns and the replies. The chat
// socket itself belongs to the lifecycle in index.ts; this module reads its connection
// state (from state.ts) to wait for it before answering.

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

const CHAT_CONNECT_POLL_MS = 250

async function waitForChat(limitMs: number): Promise<boolean> {
  const deadline = Date.now() + limitMs

  while (true) {
    const chat = chatConnection.instance
    if (!chat) return false
    if (chat.isConnected()) return true

    const remaining = deadline - Date.now()
    if (remaining <= 0) return false
    await sleep(Math.min(CHAT_CONNECT_POLL_MS, remaining))
  }
}

/** Sends a message through the chat socket of the connected account, waiting out a start or a reconnect. */
export async function replyInChat(message: string): Promise<void> {
  const chat = chatConnection.instance
  if (!chat) return

  if (!chat.isConnected()) {
    const connected = await waitForChat(chatConnection.starting ? chatConnection.startWaitMs : chatConnection.reconnectWaitMs)
    if (!connected) {
      chatLog.warn(`Chat not connected, skipping reply: ${message}`)
      return
    }
  }

  await chat.sendMessage(message).catch((error) => {
    chatLog.error(`Failed to send chat reply: ${describeError(error)}`)
  })
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

/** @internal Clears the command cooldowns (used by the integration reset and the tests). */
export function resetCommandCooldowns(): void {
  lastRun.plainCooldownSeconds = lastRun.controlCooldownSeconds = 0
}
