import { run } from '../run.js'
import { patch, isLocalDevice } from '../state.js'
import { dom } from '../dom.js'
import { trackForm } from '../form.js'
import { api } from '../api.js'
import { applyChatCommands, cancelChatCommandChanges, saveTwitchChatCommands } from './twitch-chat-commands.js'
import { connectTwitch, disconnectTwitch } from './twitch-connection.js'
import { applyRewardConfig, cancelRewardChanges, saveReward, createReward } from './twitch-rewards.js'

export { connectTwitch, disconnectTwitch, readTwitchStatus } from './twitch-connection.js'
export { onTwitchRewardChange, saveTwitchConfig } from './twitch-rewards.js'
export { saveTwitchChatCommands } from './twitch-chat-commands.js'

// the typing of the Twitch forms is marked, as bindEvents marks the settings panels
export function bindTwitchFieldTracking() {
  trackForm(dom.twitchChatCommandsPanel)
  trackForm(dom.twitchRewardSection)
  trackForm(dom.twitchRewardForm)
}

export function readTwitchConfig() {
  return run('loading Twitch config', async () => {
    if (!isLocalDevice()) return

    const config = await api.getTwitchConfig()

    patch('twitch', { config: config })
    applyRewardConfig(config)
    applyChatCommands(config)
  })
}

export const twitchActions = {
  'save-twitch-chat-commands': saveTwitchChatCommands,
  'cancel-twitch-chat-commands': cancelChatCommandChanges,
  'save-twitch-reward': saveReward,
  'cancel-twitch-reward': cancelRewardChanges,
  'create-twitch-reward': createReward,
  'connect-twitch': connectTwitch,
  'disconnect-twitch': disconnectTwitch
}
