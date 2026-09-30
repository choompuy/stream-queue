import { escapeHtml, show, setFieldState, setValue, setChecked, setText, setClass } from '../shared.js'
import { api, ApiError } from './api.js'
import { state, dom, log, CHAT_COMMAND_FIELDS } from './state.js'
import { run } from './run.js'
import { t } from '../i18n.js'
import { reportSaveResult, trackChanges } from './save-result.js'
import { setError } from '../shared.js'
import { toastSuccess } from './toast.js'

const TWITCH_POLL_INTERVAL_MS = 2000

let twitchPollController = null

export function stopTwitchPolling() {
  twitchPollController?.abort()
  twitchPollController = null
}

// resolves to false when the wait was cut short by an abort
function delay(ms, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false)
      return
    }

    const onAbort = () => {
      clearTimeout(timer)
      resolve(false)
    }

    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, ms)

    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function openAuthorizationWindow() {
  try {
    return window.open('', '_blank') ?? null
  } catch {
    return null
  }
}

function navigateAuthorizationWindow(authWindow, url) {
  if (!authWindow) {
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }

  try {
    authWindow.opener = null
    authWindow.location.href = url
  } catch (error) {
    log('Failed to navigate the Twitch authorization window:', error)
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

async function loadTwitchRewards() {
  const response = await api.getTwitchRewards()
  state.twitch.rewards = response?.rewards ?? []
  renderTwitchRewards()
}

export function connectTwitch() {
  // opened up-front so the popup is attributed to the click and not to the API response
  const authWindow = openAuthorizationWindow()

  stopTwitchPolling()
  const controller = new AbortController()
  twitchPollController = controller
  const { signal } = controller

  return run(
    'connecting Twitch',
    async () => {
      try {
        let response

        try {
          response = await api.connectTwitch()
        } catch (error) {
          authWindow?.close()
          throw error
        }

        if (!response?.verificationUri || !response?.userCode) {
          authWindow?.close()
          throw new ApiError('Twitch authorization data is missing', { code: 'TWITCH_AUTH_ERROR' })
        }

        if (signal.aborted) {
          authWindow?.close()
          return
        }

        setText(dom.twitchAuthorizationCode, response.userCode)
        show(dom.twitchAuthorization)
        navigateAuthorizationWindow(authWindow, response.verificationUri)
        const expiresAt = Date.now() + response.expiresIn * 1000

        while (Date.now() < expiresAt) {
          if (!(await delay(TWITCH_POLL_INTERVAL_MS, signal))) return

          const status = await api.getTwitchStatus()
          if (signal.aborted) return

          if (status.connected) {
            state.twitch.connected = true
            state.twitch.user = status.user
            state.twitch.connectedAt = status.connectedAt
            show(dom.twitchAuthorization, false)
            renderTwitchConnection()
            await loadTwitchRewards()
            return
          }
        }

        show(dom.twitchAuthorization, false)
        throw new ApiError('Twitch authorization expired', { code: 'TWITCH_AUTH_EXPIRED' })
      } finally {
        if (twitchPollController === controller) twitchPollController = null
      }
    },
    { button: dom.twitchConnectBtn }
  )
}

export function disconnectTwitch() {
  if (!confirm(t('settings.twitch.disconnectConfirm'))) return

  return run('disconnecting Twitch', async () => {
    stopTwitchPolling()
    await api.disconnectTwitch()
    state.twitch.connected = false
    state.twitch.user = null
    state.twitch.connectedAt = null
    state.twitch.rewards = []
    show(dom.twitchAuthorization, false)
    show(dom.twitchRewardForm, false)
    renderTwitchConnection()
    renderTwitchRewards()
  })
}

export function loadTwitchSettings() {
  return run('loading Twitch settings', async () => {
    if (!state.twitch.configured) {
      renderTwitchConnection()
      return
    }

    const status = await api.getTwitchStatus()
    state.twitch.connected = Boolean(status.connected)
    state.twitch.user = status.user
    state.twitch.connectedAt = status.connectedAt
    renderTwitchConnection()

    if (!state.twitch.connected) return

    await loadTwitchRewards()
  })
}

export function renderTwitchConnection() {
  if (!state.twitch.configured) {
    show(dom.twitchNotConfigured)
    show(dom.twitchConnectionControls, false)
    show(dom.twitchAuthorization, false)
    show(dom.twitchRewardSection, false)
    show(dom.twitchRewardForm, false)
    return
  }

  show(dom.twitchNotConfigured, false)
  show(dom.twitchConnectionControls)

  if (state.twitch.connected && state.twitch.user) {
    setText(dom.twitchChanelName, '@' + state.twitch.user.displayName)
    setClass(dom.twitchChanelName, 'text-green')
    setClass(dom.twitchChanelName, 'text-red', false)
    if (dom.twitchChanelImg) {
      show(dom.twitchChanelImg)
      dom.twitchChanelImg.src = state.twitch.user.profileImageUrl
    }

    show(dom.twitchConnectBtn, false)
    show(dom.twitchDisconnectBtn)
    show(dom.twitchRewardSection)
    show(dom.twitchChatCommandsPanel)
  } else {
    setText(dom.twitchChanelName, t('settings.twitch.notConnected'))
    setClass(dom.twitchChanelName, 'text-green', false)
    setClass(dom.twitchChanelName, 'text-red')
    if (dom.twitchChanelImg) {
      show(dom.twitchChanelImg, false)
      dom.twitchChanelImg.src = ''
    }

    show(dom.twitchConnectBtn)
    show(dom.twitchDisconnectBtn, false)
    show(dom.twitchRewardSection, false)
    show(dom.twitchChatCommandsPanel, false)
    show(dom.twitchRewardForm, false)
  }
}

export function renderTwitchRewards() {
  if (!dom.twitchRewardSelect) return

  if (!state.twitch.rewards.length) {
    dom.twitchRewardSelect.innerHTML = `<option value="">${escapeHtml(t('settings.twitch.noRewards'))}</option>`
    showRewardForm(false)
    return
  }

  const selectedId = state.twitch.selectedRewardId ?? ''
  if (selectedId) {
    const reward = state.twitch.rewards.find((r) => r.id === selectedId)
    if (reward) showRewardForm(true, reward)
  } else {
    showRewardForm(false)
  }

  dom.twitchRewardSelect.innerHTML = `
    <option value="">${escapeHtml(t('settings.twitch.rewardNone'))}</option>
    ${state.twitch.rewards
      .map(
        (reward) =>
          `<option value="${escapeHtml(reward.id)}" ${reward.id === selectedId ? 'selected' : ''}>${escapeHtml(reward.title)} (${reward.cost})</option>`
      )
      .join('')}
  `
}

export function onTwitchRewardChange() {
  const selectedId = dom.twitchRewardSelect?.value ?? ''
  state.twitch.selectedRewardId = selectedId

  if (selectedId) {
    const reward = state.twitch.rewards.find((r) => r.id === selectedId)
    if (reward) {
      showRewardForm(true, reward)
    }
  } else {
    showRewardForm(false)
  }

  saveTwitchConfig()
}

function chatCommandFields() {
  const stored = () => state.twitch.chatCommands

  const fields = CHAT_COMMAND_FIELDS.flatMap((field) => [
    {
      input: dom[`${field.dom}Command`],
      path: `chatCommands.${field.key}.command`,
      read: (input) => input.value.trim(),
      stored: () => stored()?.[field.key]?.command
    },
    {
      input: dom[`${field.dom}Permission`],
      path: `chatCommands.${field.key}.permission`,
      read: (input) => input.value,
      stored: () => stored()?.[field.key]?.permission
    }
  ])

  fields.push({
    input: dom.chatCmdCooldown,
    path: 'chatCommands.controlCooldownSeconds',
    read: (input) => Number(input.value),
    stored: () => stored()?.controlCooldownSeconds
  })
  fields.push({
    input: dom.chatCmdPlainCooldown,
    path: 'chatCommands.plainCooldownSeconds',
    read: (input) => Number(input.value),
    stored: () => stored()?.plainCooldownSeconds
  })

  return fields.filter((field) => field.input)
}

export function bindTwitchFieldTracking() {
  for (const field of chatCommandFields()) trackChanges(field.input, () => field.read(field.input) !== field.stored())

  trackChanges(dom.twitchRewardSelect, () => dom.twitchRewardSelect.value !== state.twitch.savedRewardId)
  trackChanges(dom.twitchAutoFulfillRedemptions, () => dom.twitchAutoFulfillRedemptions.checked !== state.twitch.savedAutoFulfillRedemptions)

  if (dom.twitchAutoFulfillRedemptions) {
    dom.twitchAutoFulfillRedemptions.addEventListener('change', () => {
      saveTwitchConfig()
    })
  }
}

export function loadTwitchConfig() {
  return run('loading Twitch config', async () => {
    const twitchConfig = await api.getTwitchConfig()

    state.twitch.selectedRewardId = twitchConfig?.channelPointsRewardId ?? ''
    state.twitch.savedRewardId = state.twitch.selectedRewardId
    state.twitch.savedAutoFulfillRedemptions = twitchConfig?.autoFulfillRedemptions ?? false
    state.twitch.chatCommands = twitchConfig?.chatCommands ?? null
    renderTwitchRewards()
    setFieldState(dom.twitchRewardSelect, null)
    setChecked(dom.twitchAutoFulfillRedemptions, state.twitch.savedAutoFulfillRedemptions)
    setFieldState(dom.twitchAutoFulfillRedemptions, null)

    const chatCommands = twitchConfig?.chatCommands
    if (chatCommands) {
      for (const field of CHAT_COMMAND_FIELDS) {
        const command = chatCommands[field.key]
        if (!command) continue

        const enabledInput = dom[`${field.dom}Enabled`]
        const commandInput = dom[`${field.dom}Command`]
        const permissionInput = dom[`${field.dom}Permission`]

        setChecked(enabledInput, command.enabled)
        setValue(commandInput, command.command ?? '')
        setValue(permissionInput, command.permission ?? 'moderator')
        setFieldState(commandInput, null)
        setFieldState(permissionInput, null)
      }

      setValue(dom.chatCmdCooldown, chatCommands.controlCooldownSeconds ?? 5)
      setFieldState(dom.chatCmdCooldown, null)

      setValue(dom.chatCmdPlainCooldown, chatCommands.plainCooldownSeconds ?? 5)
      setFieldState(dom.chatCmdPlainCooldown, null)
    }
  })
}

export async function saveTwitchConfig() {
  const rewardId = state.twitch.selectedRewardId || ''
  const autoFulfillRedemptions = dom.twitchAutoFulfillRedemptions?.checked ?? false
  const entries = [
    {
      input: dom.twitchRewardSelect,
      path: 'channelPointsRewardId',
      changed: rewardId !== state.twitch.savedRewardId
    },
    {
      input: dom.twitchAutoFulfillRedemptions,
      path: 'autoFulfillRedemptions',
      changed: autoFulfillRedemptions !== state.twitch.savedAutoFulfillRedemptions
    }
  ]

  await run('saving Twitch config', async () => {
    const { config, rejected } = await api.updateTwitchConfig({
      channelPointsRewardId: rewardId || null,
      autoFulfillRedemptions
    })

    state.twitch.savedRewardId = config.channelPointsRewardId ?? ''
    state.twitch.savedAutoFulfillRedemptions = config.autoFulfillRedemptions ?? false
    reportSaveResult(entries, rejected, 'toast.twitchSettingsSaved')
  })
}

export async function saveTwitchChatCommands() {
  const chatCommands = {}

  for (const field of CHAT_COMMAND_FIELDS) {
    chatCommands[field.key] = {
      enabled: Boolean(dom[`${field.dom}Enabled`]?.checked),
      command: dom[`${field.dom}Command`]?.value.trim() ?? '',
      permission: dom[`${field.dom}Permission`]?.value ?? 'moderator'
    }
  }

  chatCommands.controlCooldownSeconds = Number(dom.chatCmdCooldown?.value ?? 5)
  chatCommands.plainCooldownSeconds = Number(dom.chatCmdPlainCooldown?.value ?? 5)

  const entries = chatCommandFields().map((field) => ({
    input: field.input,
    path: field.path,
    changed: field.read(field.input) !== field.stored()
  }))

  await run('saving Twitch chat commands', async () => {
    const { config, rejected } = await api.updateTwitchConfig({ chatCommands })

    state.twitch.chatCommands = config.chatCommands

    for (const field of chatCommandFields()) {
      const storedValue = field.stored()
      if (!rejected.includes(field.path) && storedValue !== undefined) setValue(field.input, storedValue)
    }

    reportSaveResult(entries, rejected, 'toast.twitchChatCommandsSaved')
  })
}

export function loadTwitchSecrets() {
  return run('loading Twitch secrets', async () => {
    const data = await api.getSecrets()
    state.twitch.configured = Boolean(data.twitch?.configured)
    renderTwitchConnection()
  })
}

const REWARD_FIELDS = [
  { toggle: dom.twitchMaxPerStreamEnabled, input: dom.twitchMaxPerStream, key: 'max_per_stream' },
  { toggle: dom.twitchMaxPerUserPerStreamEnabled, input: dom.twitchMaxPerUserPerStream, key: 'max_per_user_per_stream' },
  { toggle: dom.twitchGlobalCooldownEnabled, input: dom.twitchGlobalCooldownSeconds, key: 'global_cooldown' }
]

const REWARD_FORM_FIELDS = [
  dom.twitchRewardTitle,
  dom.twitchRewardCost,
  dom.twitchRewardPrompt,
  dom.twitchRewardBackgroundColor,
  dom.twitchRewardBackgroundColorPicker,
  dom.twitchRewardEnabled,
  ...REWARD_FIELDS.map((f) => f.toggle),
  ...REWARD_FIELDS.map((f) => f.input)
]

const REWARD_FIELD_MAPPING = {
  twitchRewardTitle: 'title',
  twitchRewardCost: 'cost',
  twitchRewardPrompt: 'prompt',
  twitchRewardBackgroundColor: 'background_color',
  twitchRewardBackgroundColorPicker: 'background_color',
  twitchRewardEnabled: 'is_enabled',
  twitchMaxPerStreamEnabled: 'is_max_per_stream_enabled',
  twitchMaxPerStream: 'max_per_stream',
  twitchMaxPerUserPerStreamEnabled: 'is_max_per_user_per_stream_enabled',
  twitchMaxPerUserPerStream: 'max_per_user_per_stream',
  twitchGlobalCooldownEnabled: 'is_global_cooldown_enabled',
  twitchGlobalCooldownSeconds: 'global_cooldown_seconds'
}

let savedRewardData = null

function showRewardForm(isEdit = false, reward) {
  show(dom.twitchRewardForm)

  if (isEdit && reward) {
    state.twitch.currentEditingRewardId = reward.id
    savedRewardData = { ...reward }
    setText(dom.twitchRewardForm.querySelector('h2'), t('settings.twitch.editReward'))
    setValue(dom.twitchRewardTitle, reward.title || '')
    setValue(dom.twitchRewardCost, reward.cost || '')
    setValue(dom.twitchRewardPrompt, reward.prompt || '')
    const bgColor = reward.background_color || ''
    setValue(dom.twitchRewardBackgroundColor, bgColor)
    if (dom.twitchRewardBackgroundColorPicker) {
      dom.twitchRewardBackgroundColorPicker.value = bgColor || '#000000'
    }
    setChecked(dom.twitchRewardEnabled, reward.is_enabled || false)

    for (const field of REWARD_FIELDS) {
      const setting = reward[`${field.key}_setting`]
      if (setting?.is_enabled) {
        setChecked(field.toggle, true)

        if (field.key === 'global_cooldown') setValue(field.input, setting[field.key + '_seconds'] || '')
        else setValue(field.input, setting[field.key] || '')
        field.input.disabled = false
      } else {
        setChecked(field.toggle, false)
        setValue(field.input, '')
        field.input.disabled = true
      }
    }
  } else {
    state.twitch.currentEditingRewardId = null
    savedRewardData = null
    setText(dom.twitchRewardForm.querySelector('h2'), t('settings.twitch.createReward'))
    setValue(dom.twitchRewardTitle, '')
    setValue(dom.twitchRewardCost, '')
    setValue(dom.twitchRewardPrompt, '')
    setValue(dom.twitchRewardBackgroundColor, '')
    if (dom.twitchRewardBackgroundColorPicker) {
      dom.twitchRewardBackgroundColorPicker.value = '#000000'
    }
    setChecked(dom.twitchRewardEnabled, true)

    for (const field of REWARD_FIELDS) {
      setChecked(field.toggle, false)
      setValue(field.input, '')
      field.input.disabled = true
    }
  }

  for (const input of REWARD_FORM_FIELDS) {
    if (input) setFieldState(input, null)
  }
}

function handleToggleSwitch(field) {
  if (!field.toggle || !field.input) return

  field.toggle.addEventListener('change', () => {
    field.input.disabled = !field.toggle.checked
    if (!field.toggle.checked) {
      setValue(field.input, '')
    }
  })
}

async function saveReward() {
  const title = dom.twitchRewardTitle?.value?.trim()
  const cost = Number(dom.twitchRewardCost?.value)
  const prompt = dom.twitchRewardPrompt?.value?.trim()
  const isEnabled = Boolean(dom.twitchRewardEnabled?.checked)
  const backgroundColor = dom.twitchRewardBackgroundColor?.value?.trim()
  const isMaxPerStreamEnabled = Boolean(dom.twitchMaxPerStreamEnabled?.checked)
  const maxPerStream = Number(dom.twitchMaxPerStream?.value)
  const isMaxPerUserPerStreamEnabled = Boolean(dom.twitchMaxPerUserPerStreamEnabled?.checked)
  const maxPerUserPerStream = Number(dom.twitchMaxPerUserPerStream?.value)
  const isGlobalCooldownEnabled = Boolean(dom.twitchGlobalCooldownEnabled?.checked)
  const globalCooldownSeconds = Number(dom.twitchGlobalCooldownSeconds?.value)

  let hasError = false

  if (!title) {
    setError(dom.twitchRewardTitle, true)
    hasError = true
  } else if (title.length > 45) {
    setError(dom.twitchRewardTitle, true)
    hasError = true
  } else {
    setError(dom.twitchRewardTitle, false)
  }

  if (!cost || cost < 1) {
    setError(dom.twitchRewardCost, true)
    hasError = true
  } else {
    setError(dom.twitchRewardCost, false)
  }

  if (prompt && prompt.length > 140) {
    setError(dom.twitchRewardPrompt, true)
    hasError = true
  } else {
    setError(dom.twitchRewardPrompt, false)
  }

  if (backgroundColor && !/^#[0-9A-Fa-f]{6}$/.test(backgroundColor)) {
    setError(dom.twitchRewardBackgroundColor, true)
    hasError = true
  } else {
    setError(dom.twitchRewardBackgroundColor, false)
  }

  if (!Number.isInteger(cost)) {
    setError(dom.twitchRewardCost, true)
    hasError = true
  }

  for (const field of REWARD_FIELDS) {
    const isEnabled = Boolean(field.toggle?.checked)
    const value = Number(field.input?.value)
    if (isEnabled && (!value || value < 1 || !Number.isInteger(value))) {
      setError(field.input, true)
      hasError = true
    } else {
      setError(field.input, false)
    }
  }

  if (hasError) return

  const isEdit = state.twitch.currentEditingRewardId !== null
  const actionName = isEdit ? 'updating Twitch reward' : 'creating Twitch reward'

  await run(actionName, async () => {
    const data = {
      title,
      cost,
      prompt: isEdit ? prompt : prompt || undefined,
      is_enabled: isEnabled,
      background_color: backgroundColor || undefined,
      is_max_per_stream_enabled: isMaxPerStreamEnabled,
      max_per_stream: isMaxPerStreamEnabled ? maxPerStream : undefined,
      is_max_per_user_per_stream_enabled: isMaxPerUserPerStreamEnabled,
      max_per_user_per_stream: isMaxPerUserPerStreamEnabled ? maxPerUserPerStream : undefined,
      is_global_cooldown_enabled: isGlobalCooldownEnabled,
      global_cooldown_seconds: isGlobalCooldownEnabled ? globalCooldownSeconds : undefined
    }

    let response
    if (isEdit) {
      response = await api.updateTwitchReward(state.twitch.currentEditingRewardId, data)
    } else {
      response = await api.createTwitchReward(data)
    }

    if (response?.reward) {
      await loadTwitchRewards()
      if (!isEdit) {
        state.twitch.selectedRewardId = response.reward.id
        renderTwitchRewards()
        await saveTwitchConfig()
        toastSuccess(t('toast.twitchRewardCreated'))
      } else {
        savedRewardData = { ...response.reward }
        for (const input of REWARD_FORM_FIELDS) {
          if (input) setFieldState(input, 'saved')
        }
        toastSuccess(t('toast.twitchRewardUpdated'))
      }
    }
  })
}

export function bindTwitchRewardFormEvents() {
  if (dom.twitchCreateNewRewardBtn) {
    dom.twitchCreateNewRewardBtn.addEventListener('click', () => {
      dom.twitchRewardSelect.value = ''
      state.twitch.selectedRewardId = ''
      showRewardForm(false)
    })
  }

  if (dom.twitchSaveRewardBtn) {
    dom.twitchSaveRewardBtn.addEventListener('click', saveReward)
  }

  for (const field of REWARD_FIELDS) {
    handleToggleSwitch(field)
  }

  const inputs = [
    dom.twitchRewardTitle,
    dom.twitchRewardCost,
    dom.twitchRewardPrompt,
    dom.twitchRewardBackgroundColor,
    ...REWARD_FIELDS.map((f) => f.input)
  ]

  inputs.forEach((input) => {
    if (input) {
      input.addEventListener('input', () => setError(input, false))
      input.addEventListener('change', () => setError(input, false))
    }
  })

  if (dom.twitchRewardBackgroundColor && dom.twitchRewardBackgroundColorPicker) {
    dom.twitchRewardBackgroundColorPicker.addEventListener('input', () => {
      const hex = dom.twitchRewardBackgroundColorPicker.value.toUpperCase()
      dom.twitchRewardBackgroundColor.value = hex
      setError(dom.twitchRewardBackgroundColor, false)
    })

    dom.twitchRewardBackgroundColor.addEventListener('input', () => {
      const hex = dom.twitchRewardBackgroundColor.value.trim()
      if (/^[0-9A-Fa-f]{6}$/.test(hex)) {
        dom.twitchRewardBackgroundColorPicker.value = hex
      }
      setError(dom.twitchRewardBackgroundColor, false)
    })
  }

  for (const input of REWARD_FORM_FIELDS) {
    if (input) {
      trackChanges(input, () => {
        if (!savedRewardData) return false
        const key = REWARD_FIELD_MAPPING[input.id]
        if (!key) return false

        if (input.type === 'checkbox') {
          return input.checked !== (savedRewardData[key] || false)
        }
        if (input.type === 'number') {
          return Number(input.value) !== (savedRewardData[key] || 0)
        }
        if (input.type === 'color') {
          const hex = input.value.toUpperCase()
          return hex !== (savedRewardData[key] || '')
        }
        const value = input.value.trim()
        const savedValue = savedRewardData[key]
        if (key === 'background_color') {
          return value !== (savedValue || '')
        }
        return value !== (savedValue || '')
      })
    }
  }
}

export const twitchActions = {
  'save-twitch-chat-commands': saveTwitchChatCommands,
  'connect-twitch': connectTwitch,
  'disconnect-twitch': disconnectTwitch
}
