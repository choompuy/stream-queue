import { setError, setFieldState, setValue, setChecked, setText } from '../../shared.js'
import { t } from '../../i18n.js'
import { state, dom } from '../state.js'
import { trackChanges } from '../save-result.js'

const TITLE_MAX_LENGTH = 45
const PROMPT_MAX_LENGTH = 140
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/
const DEFAULT_COLOR = '#000000'

// `key` names Twitch's `<key>_setting` object and the `is_<key>_enabled` flag, `value` names the number inside them
const LIMITS = [
  {
    toggle: dom.twitchMaxPerStreamEnabled,
    input: dom.twitchMaxPerStream,
    key: 'max_per_stream',
    value: 'max_per_stream'
  },
  {
    toggle: dom.twitchMaxPerUserPerStreamEnabled,
    input: dom.twitchMaxPerUserPerStream,
    key: 'max_per_user_per_stream',
    value: 'max_per_user_per_stream'
  },
  {
    toggle: dom.twitchGlobalCooldownEnabled,
    input: dom.twitchGlobalCooldownSeconds,
    key: 'global_cooldown',
    value: 'global_cooldown_seconds'
  }
]

// every form input with the way to read what Twitch has stored for it (the type of that value decides how the input is read)
const FIELDS = [
  [dom.twitchRewardTitle, (r) => r.title || ''],
  [dom.twitchRewardCost, (r) => r.cost || 0],
  [dom.twitchRewardPrompt, (r) => r.prompt || ''],
  [dom.twitchRewardBackgroundColor, (r) => r.background_color || ''],
  [dom.twitchRewardBackgroundColorPicker, (r) => (r.background_color || DEFAULT_COLOR).toUpperCase()],
  [dom.twitchRewardEnabled, (r) => Boolean(r.is_enabled)],
  ...LIMITS.flatMap(({ toggle, input, key, value }) => [
    [toggle, (r) => Boolean(r[`${key}_setting`]?.is_enabled)],
    [input, (r) => r[`${key}_setting`]?.[value] || 0]
  ])
].filter(([input]) => input)

function readField(input, saved) {
  if (typeof saved === 'boolean') return input.checked
  if (typeof saved === 'number') return Number(input.value)
  return input.type === 'color' ? input.value.toUpperCase() : input.value.trim()
}

function differs(input, saved, reward) {
  const stored = saved(reward)
  return readField(input, stored) !== stored
}

function clearFieldStates() {
  for (const [input] of FIELDS) setFieldState(input, null)
}

// shows the form filled with `reward` to edit it, or blank to create a new one
export function showRewardForm(reward = null) {
  state.twitch.editingReward = reward && { ...reward }

  setText(dom.twitchRewardForm?.querySelector('h2'), t(reward ? 'settings.twitch.editReward' : 'settings.twitch.createReward'))
  setValue(dom.twitchRewardTitle, reward?.title || '')
  setValue(dom.twitchRewardCost, reward?.cost || '')
  setValue(dom.twitchRewardPrompt, reward?.prompt || '')
  setValue(dom.twitchRewardBackgroundColor, reward?.background_color || '')
  setValue(dom.twitchRewardBackgroundColorPicker, reward?.background_color || DEFAULT_COLOR)
  setChecked(dom.twitchRewardEnabled, reward ? Boolean(reward.is_enabled) : true)

  for (const { toggle, input, key, value } of LIMITS) {
    const setting = reward?.[`${key}_setting`]
    const enabled = Boolean(setting?.is_enabled)
    setChecked(toggle, enabled)
    setValue(input, enabled ? setting[value] || '' : '')
    if (input) input.disabled = !enabled
  }

  clearFieldStates()
}

// `previous` is the reward as it was before the save: only the inputs that differ from it were really saved
export function markRewardSaved(reward, previous) {
  state.twitch.editingReward = { ...reward }
  for (const [input, saved] of FIELDS) setFieldState(input, previous && differs(input, saved, previous) ? 'saved' : null)
}

function check(input, valid) {
  setError(input, !valid)
  return valid
}

// marks every invalid input and returns the request body, or null when something is invalid
export function readRewardForm() {
  const title = dom.twitchRewardTitle?.value.trim()
  const cost = Number(dom.twitchRewardCost?.value)
  const prompt = dom.twitchRewardPrompt?.value.trim()
  const color = dom.twitchRewardBackgroundColor?.value.trim()
  const data = {
    title,
    cost,
    // an empty prompt has to be sent to clear it on an existing reward
    prompt: state.twitch.editingReward ? prompt : prompt || undefined,
    is_enabled: Boolean(dom.twitchRewardEnabled?.checked),
    background_color: color || undefined
  }

  const results = [
    check(dom.twitchRewardTitle, Boolean(title) && title.length <= TITLE_MAX_LENGTH),
    check(dom.twitchRewardCost, Number.isInteger(cost) && cost >= 1),
    check(dom.twitchRewardPrompt, !prompt || prompt.length <= PROMPT_MAX_LENGTH),
    check(dom.twitchRewardBackgroundColor, !color || HEX_COLOR.test(color))
  ]

  for (const { toggle, input, key, value } of LIMITS) {
    const enabled = Boolean(toggle?.checked)
    const number = Number(input?.value)
    data[`is_${key}_enabled`] = enabled
    data[value] = enabled ? number : undefined
    results.push(check(input, !enabled || (Number.isInteger(number) && number >= 1)))
  }

  return results.every(Boolean) ? data : null
}

export function bindRewardForm() {
  for (const { toggle, input } of LIMITS) {
    if (!toggle || !input) continue

    toggle.addEventListener('change', () => {
      input.disabled = !toggle.checked
      if (!toggle.checked) setValue(input, '')
    })
  }

  const editable = [
    dom.twitchRewardTitle,
    dom.twitchRewardCost,
    dom.twitchRewardPrompt,
    dom.twitchRewardBackgroundColor,
    ...LIMITS.map((l) => l.input)
  ]
  for (const input of editable.filter(Boolean)) {
    for (const event of ['input', 'change']) input.addEventListener(event, () => setError(input, false))
  }

  const { twitchRewardBackgroundColor: colorText, twitchRewardBackgroundColorPicker: colorPicker } = dom
  if (colorText && colorPicker) {
    colorPicker.addEventListener('input', () => {
      colorText.value = colorPicker.value.toUpperCase()
      setError(colorText, false)
    })

    colorText.addEventListener('input', () => {
      const hex = colorText.value.trim()
      if (HEX_COLOR.test(hex)) colorPicker.value = hex
    })
  }

  for (const [input, saved] of FIELDS) {
    trackChanges(input, () => Boolean(state.twitch.editingReward) && differs(input, saved, state.twitch.editingReward))
  }
}
