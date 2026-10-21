import { setTimeout as sleep } from 'node:timers/promises'
import { chatConnection, getTunables } from './state.js'
import { createLogger, describeError } from '../../logger.js'

// The one sender into the Twitch chat. The replies of the commands and the messages of the
// redemption pipeline (accepted, refunded) go through it alike, so neither module depends on
// the other for that. The socket itself belongs to the lifecycle in index.ts; this module reads
// its connection state (from state.ts) to wait for it before sending.

const chatLog = createLogger('TWITCH CHAT')

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
    const { chatStartWaitMs, chatReconnectWaitMs } = getTunables()
    const connected = await waitForChat(chatConnection.starting ? chatStartWaitMs : chatReconnectWaitMs)
    if (!connected) {
      chatLog.warn(`Chat not connected, skipping reply: ${message}`)
      return
    }
  }

  await chat.sendMessage(message).catch((error) => {
    chatLog.error(`Failed to send chat reply: ${describeError(error)}`)
  })
}
