import type { TwitchAuthConfig, TwitchUserInfo, TwitchDeviceCodeResponse } from './types.js'
import type { TwitchHealth } from './integration.js'
import type { TwitchClient } from './client.js'
import type { TwitchIntegration } from './integration.js'
import type { TwitchDeps } from './integration.js'
import { createTwitchIntegration as createTwitchIntegrationImpl } from './integration.js'
import { hasPermission, matchesCommand } from './chat-commands.js'
import type { TwitchChatMessage } from './types.js'

let current: TwitchIntegration | null = null

export function initializeTwitchIntegration(config: Partial<TwitchAuthConfig> = {}, deps?: Partial<TwitchDeps>): void {
  if (current) {
    console.log('Twitch integration already initialized')
    return
  }

  current = createTwitchIntegrationImpl({ clientId: config.clientId || '' }, deps)
  console.log('Twitch integration initialized')
}

export function getTwitchIntegration(): TwitchIntegration | null {
  return current
}

export async function startDeviceAuthorization(): Promise<TwitchDeviceCodeResponse> {
  const integration = getTwitchIntegration()
  if (!integration) throw new Error('Twitch integration not initialized')
  return integration.startDeviceAuthorization()
}

export async function disconnect(): Promise<void> {
  const integration = getTwitchIntegration()
  if (!integration) throw new Error('Twitch integration not initialized')
  return integration.disconnect()
}

export async function refreshConnection(): Promise<TwitchUserInfo> {
  const integration = getTwitchIntegration()
  if (!integration) throw new Error('Twitch integration not initialized')
  return integration.refreshConnection()
}

export function getClient(): TwitchClient | null {
  const integration = getTwitchIntegration()
  if (!integration) return null
  return integration.getClient()
}

export function getTwitchHealth(): TwitchHealth {
  const integration = getTwitchIntegration()
  if (!integration) return { auth: 'ok', eventSub: false, chat: false }
  return integration.getHealth()
}

export { hasPermission, matchesCommand }

export type { TwitchChatMessage }
