import { t } from '../../i18n.js'
import { patch } from '../state.js'
import { dom } from '../dom.js'
import { fillForm, markChanged } from '../form.js'

// The form is filled with a reward as the server describes it and sent back in the same shape (see form.js and src/integrations/twitch/rewards.ts):
// the server checks and normalises everything and names the fields that are wrong.
const DEFAULT_COLOR = '#000000'
const NO_LIMIT = { enabled: false, value: null }

// a reward that is being created
const BLANK_REWARD = {
  title: '',
  cost: null,
  prompt: '',
  backgroundColor: '',
  isEnabled: true,
  limits: { maxPerStream: NO_LIMIT, maxPerUserPerStream: NO_LIMIT, globalCooldownSeconds: NO_LIMIT }
}

// the colour picker follows the colour that is typed, as far as it is a colour
function syncColorPicker() {
  const hex = /^#?([0-9a-f]{6})$/i.exec(dom.twitchRewardBackgroundColor.value.trim())?.[1]
  dom.twitchRewardBackgroundColorPicker.value = hex ? `#${hex.toLowerCase()}` : DEFAULT_COLOR
}

// shows the form filled with `reward` to edit it, or blank to create a new one
export function showRewardForm(reward = null) {
  patch('twitch', { editingReward: reward })

  dom.twitchRewardForm.querySelector('h2').textContent = t(reward ? 'settings.twitch.editReward' : 'settings.twitch.createReward')
  fillForm(dom.twitchRewardForm, reward ?? BLANK_REWARD)
  syncColorPicker()
}

export function bindRewardForm() {
  const { twitchRewardBackgroundColor: colorText, twitchRewardBackgroundColorPicker: colorPicker } = dom

  colorText.addEventListener('input', syncColorPicker)

  // picking a colour types it, so it is marked and sent like any typed value
  colorPicker.addEventListener('input', () => {
    colorText.value = colorPicker.value.toUpperCase()
    markChanged(colorText)
  })
}
