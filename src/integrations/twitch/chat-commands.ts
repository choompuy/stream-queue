import type { TwitchChatMessage, TwitchChatPermission } from '../../core/types.js'
import type { TwitchChatCommandsConfig } from '../../core/types.js'

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
export function matchesCommand(text: string, command: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ')
  return normalized === command || normalized.startsWith(`${command} `)
}

export type ChatCommandDeps = {
  buildNowPlayingMessage: () => string
  buildQueueMessage: () => string
  skipCurrent: () => void
  getState: () => { current: { title: string; requestedBy: string } | null; queue: Array<{ title: string }>; isPaused: boolean }
  setPaused: (paused: boolean) => void
  translate: (key: string, params?: Record<string, string | number>, fallback?: string) => string
}

export class ChatCommands {
  private deps: ChatCommandDeps
  private lastRun = { plainCooldownSeconds: 0, controlCooldownSeconds: 0 }
  private onReply: (message: string) => Promise<void>

  constructor(deps: ChatCommandDeps, onReply: (message: string) => Promise<void>) {
    this.deps = deps
    this.onReply = onReply
  }

  async handle(message: TwitchChatMessage, commands: TwitchChatCommandsConfig): Promise<void> {
    const { now, queue, skip, pause, resume, controlCooldownSeconds, plainCooldownSeconds } = commands

    if (now.enabled && matchesCommand(message.text, now.command) && hasPermission(message, now.permission)) {
      await this.runCommand(message, 'plainCooldownSeconds', plainCooldownSeconds, this.deps.buildNowPlayingMessage)
      return
    }

    if (queue.enabled && matchesCommand(message.text, queue.command) && hasPermission(message, queue.permission)) {
      await this.runCommand(message, 'plainCooldownSeconds', plainCooldownSeconds, this.deps.buildQueueMessage)
      return
    }

    if (skip.enabled && matchesCommand(message.text, skip.command) && hasPermission(message, skip.permission)) {
      await this.runCommand(message, 'controlCooldownSeconds', controlCooldownSeconds, () => {
        this.deps.skipCurrent()
        return this.deps.getState().current?.title
          ? this.deps.translate('chat.skippedNowPlaying', { title: this.deps.getState().current!.title }, `Track skipped. Now playing: ${this.deps.getState().current!.title}`)
          : this.deps.translate('chat.skipped', undefined, 'Track skipped')
      })
      return
    }

    if (pause.enabled && matchesCommand(message.text, pause.command) && hasPermission(message, pause.permission)) {
      await this.runCommand(message, 'controlCooldownSeconds', controlCooldownSeconds, () => {
        this.deps.setPaused(true)
        return this.deps.translate('chat.paused', undefined, 'Player paused')
      })
      return
    }

    if (resume.enabled && matchesCommand(message.text, resume.command) && hasPermission(message, resume.permission)) {
      await this.runCommand(message, 'controlCooldownSeconds', controlCooldownSeconds, () => {
        this.deps.setPaused(false)
        return this.deps.translate('chat.resumed', undefined, 'Playback resumed')
      })
      return
    }
  }

  private async runCommand(message: TwitchChatMessage, cooldown: keyof typeof this.lastRun, cooldownSeconds: number, action: () => string): Promise<void> {
    const now = Date.now()
    if (now - this.lastRun[cooldown] < cooldownSeconds * 1000) {
      return
    }
    this.lastRun[cooldown] = now

    await this.onReply(action())
  }

  resetCooldowns(): void {
    this.lastRun.plainCooldownSeconds = 0
    this.lastRun.controlCooldownSeconds = 0
  }
}
