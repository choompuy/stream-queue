import { api } from '../api.js'
import { run } from '../run.js'
import { state } from '../state.js'
import { dom } from '../dom.js'
import { fillForm, saveForm, toastSaveResult, trackForm } from '../form.js'

// the chat commands are the inputs of the panel that are named chatCommands.*, see form.js
export function bindChatCommandTracking() {
  trackForm(dom.twitchChatCommandsPanel)
}

export function applyChatCommands(config) {
  fillForm(dom.twitchChatCommandsPanel, config)
}

export function cancelChatCommandChanges() {
  fillForm(dom.twitchChatCommandsPanel, state.twitch.config)
}

export function saveTwitchChatCommands() {
  return run('saving Twitch chat commands', async () => {
    const result = await saveForm(dom.twitchChatCommandsPanel, async (body) => {
      const answer = await api.updateTwitchConfig(body)
      state.twitch.config = answer.config
      return answer
    })

    toastSaveResult(result, 'toast.twitchChatCommandsSaved')
  })
}
