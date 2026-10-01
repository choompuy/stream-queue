import { setChecked, setFieldState, setValue } from '../../shared.js'
import { api } from '../api.js'
import { run } from '../run.js'
import { state, dom, CHAT_COMMAND_FIELDS } from '../state.js'
import { reportSaveResult, trackChanges } from '../save-result.js'

const DEFAULT_COOLDOWN_SECONDS = 5
const DEFAULT_PERMISSION = 'moderator'

const COOLDOWNS = [
  { key: 'controlCooldownSeconds', input: dom.chatCmdCooldown },
  { key: 'plainCooldownSeconds', input: dom.chatCmdPlainCooldown }
]

const commandInputs = ({ dom: id }) => ({ enabled: dom[`${id}Enabled`], command: dom[`${id}Command`], permission: dom[`${id}Permission`] })

// an input tied to a value stored in the config: `path` is how the server names it in `rejected`
const field = (input, path, read, write = setValue) => ({
  input,
  path: `chatCommands.${path}`,
  read,
  write,
  stored: () => path.split('.').reduce((value, key) => value?.[key], state.twitch.chatCommands)
})

function chatCommandFields() {
  return [
    ...CHAT_COMMAND_FIELDS.flatMap((config) => {
      const { enabled, command, permission } = commandInputs(config)
      return [
        field(enabled, `${config.key}.enabled`, (input) => input.checked, setChecked),
        field(command, `${config.key}.command`, (input) => input.value.trim()),
        field(permission, `${config.key}.permission`, (input) => input.value)
      ]
    }),
    ...COOLDOWNS.map(({ key, input }) => field(input, key, (input) => Number(input.value)))
  ].filter((f) => f.input)
}

export function bindChatCommandTracking() {
  for (const f of chatCommandFields()) trackChanges(f.input, () => f.read(f.input) !== f.stored())
}

export function applyChatCommands(chatCommands) {
  state.twitch.chatCommands = chatCommands ?? null
  if (!chatCommands) return

  for (const config of CHAT_COMMAND_FIELDS) {
    const command = chatCommands[config.key]
    if (!command) continue

    const { enabled, command: commandInput, permission } = commandInputs(config)
    setChecked(enabled, command.enabled)
    setFieldState(enabled, null)
    setValue(commandInput, command.command ?? '')
    setValue(permission, command.permission ?? DEFAULT_PERMISSION)
    setFieldState(commandInput, null)
    setFieldState(permission, null)
  }

  for (const { key, input } of COOLDOWNS) {
    setValue(input, chatCommands[key] ?? DEFAULT_COOLDOWN_SECONDS)
    setFieldState(input, null)
  }
}

export function cancelChatCommandChanges() {
  applyChatCommands(state.twitch.chatCommands)
}

export async function saveTwitchChatCommands() {
  const chatCommands = {}

  for (const config of CHAT_COMMAND_FIELDS) {
    const { enabled, command, permission } = commandInputs(config)
    chatCommands[config.key] = {
      enabled: Boolean(enabled?.checked),
      command: command?.value.trim() ?? '',
      permission: permission?.value ?? DEFAULT_PERMISSION
    }
  }

  for (const { key, input } of COOLDOWNS) chatCommands[key] = Number(input?.value ?? DEFAULT_COOLDOWN_SECONDS)

  const fields = chatCommandFields()
  const entries = fields.map((f) => ({ input: f.input, path: f.path, changed: f.read(f.input) !== f.stored() }))

  await run('saving Twitch chat commands', async () => {
    const { config, rejected } = await api.updateTwitchConfig({ chatCommands })

    state.twitch.chatCommands = config.chatCommands

    for (const f of fields) {
      const stored = f.stored()
      if (!rejected.includes(f.path) && stored !== undefined) f.write(f.input, stored)
    }

    reportSaveResult(entries, rejected, 'toast.twitchChatCommandsSaved')
  })
}
