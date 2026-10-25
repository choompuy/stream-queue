import { api } from '../api.js'
import { state, patch } from '../state.js'
import { dom } from '../dom.js'
import { defineFormPanel } from '../form.js'

// the chat commands panel: the config topic fills it (through readTwitchConfig), the buttons save what changed
// and put the stored values back
const chatCommands = defineFormPanel(dom.twitchChatCommandsPanel, {
  save: async (body) => {
    const answer = await api.updateTwitchConfig(body)
    patch('twitch', { config: answer.config })
    return answer
  },
  stored: () => state.twitch.config,
  toastKey: 'toast.twitchChatCommandsSaved'
})

// the chat commands are the inputs of the panel that are named chatCommands.*, see form.js
export function applyChatCommands(config) {
  chatCommands.fill(config)
}

export function cancelChatCommandChanges() {
  chatCommands.cancel()
}

export async function saveTwitchChatCommands() {
  chatCommands.toastResult(await chatCommands.saveChanges())
}
