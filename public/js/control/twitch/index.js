import { api } from '../api.js'
import { run } from '../run.js'
import { applyChatCommands, bindChatCommandTracking, cancelChatCommandChanges, saveTwitchChatCommands } from './twitch-chat-commands.js'
import { connectTwitch, disconnectTwitch } from './twitch-connection.js'
import { applyRewardConfig, bindTwitchRewardTracking, cancelRewardChanges, saveReward } from './twitch-rewards.js'

export { stopTwitchPolling, connectTwitch, disconnectTwitch, loadTwitchSettings, loadTwitchSecrets, refreshTwitchHealth } from './twitch-connection.js'
export { onTwitchRewardChange, saveTwitchConfig, bindTwitchRewardFormEvents } from './twitch-rewards.js'
export { saveTwitchChatCommands } from './twitch-chat-commands.js'

export function bindTwitchFieldTracking() {
  bindChatCommandTracking()
  bindTwitchRewardTracking()
}

export function loadTwitchConfig() {
  return run('loading Twitch config', async () => {
    const config = await api.getTwitchConfig()

    applyRewardConfig(config)
    applyChatCommands(config?.chatCommands)
  })
}

export const twitchActions = {
  'save-twitch-chat-commands': saveTwitchChatCommands,
  'cancel-twitch-chat-commands': cancelChatCommandChanges,
  'save-twitch-reward': saveReward,
  'cancel-twitch-reward': cancelRewardChanges,
  'connect-twitch': connectTwitch,
  'disconnect-twitch': disconnectTwitch
}
