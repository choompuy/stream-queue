import { t } from '../../i18n.js'
import { api } from '../api.js'
import { run } from '../run.js'
import { state, patch } from '../state.js'
import { dom } from '../dom.js'
import { fillForm, saveForm, toastSaveResult, trackForm } from '../form.js'
import { showRewardForm, bindRewardForm } from './twitch-reward-form.js'

function option(select, value, text, selected = false) {
  const element = select.ownerDocument.createElement('option')
  element.value = value
  element.textContent = text
  element.selected = selected
  return element
}

// the select of the rewards of the channel (its form is not touched)
function renderRewardOptions() {
  const select = dom.twitchRewardSelect
  const { rewards, selectedRewardId } = state.twitch

  if (!rewards.length) {
    select.replaceChildren(option(select, '', t('settings.twitch.noRewards')))
  } else {
    select.replaceChildren(
      option(select, '', t('settings.twitch.rewardNone')),
      ...rewards.map((reward) => option(select, reward.id, `${reward.title} (${reward.cost})`, reward.id === selectedRewardId))
    )
  }

  // the options are new: what is stored is what they are measured against
  if (state.twitch.config) fillForm(dom.twitchRewardSection, state.twitch.config)
}

// the reward that is selected goes into the form, no reward selected is a blank form to create one
function showSelectedReward() {
  showRewardForm(state.twitch.rewards.find((reward) => reward.id === state.twitch.selectedRewardId))
}

export function renderTwitchRewards() {
  renderRewardOptions()
  showSelectedReward()
}

async function readRewards() {
  patch('twitch', { rewards: (await api.getTwitchRewards()).rewards })
  renderRewardOptions()
}

export async function loadTwitchRewards() {
  await readRewards()
  showSelectedReward()
}

export function onTwitchRewardChange() {
  patch('twitch', { selectedRewardId: dom.twitchRewardSelect.value })
  showSelectedReward()
  saveTwitchConfig()
}

export function applyRewardConfig(config) {
  patch('twitch', { selectedRewardId: config.channelPointsRewardId ?? '' })
  renderTwitchRewards()
  fillForm(dom.twitchRewardSection, config)
}

function persistTwitchConfig() {
  return saveForm(
    dom.twitchRewardSection,
    async (body) => {
      const answer = await api.updateTwitchConfig(body)
      patch('twitch', { config: answer.config })
      return answer
    },
    { changedOnly: true }
  )
}

// the selected reward and the auto-fulfil switch are saved at once, whenever one of them changes
export function saveTwitchConfig() {
  return run('saving Twitch config', async () => toastSaveResult(await persistTwitchConfig(), 'toast.twitchSettingsSaved'))
}

// back to the reward as Twitch has it (or to a blank form while a new one is being created)
export function cancelRewardChanges() {
  showRewardForm(state.twitch.editingReward)
}

export async function saveReward() {
  const editing = state.twitch.editingReward

  const result = await saveForm(dom.twitchRewardForm, (body) => (editing ? api.updateTwitchReward(editing.id, body) : api.createTwitchReward(body)))

  if (result.refused) return toastSaveResult(result, 'toast.twitchRewardUpdated')

  await readRewards()

  if (editing) {
    patch('twitch', { editingReward: result.config })
    return toastSaveResult(result, 'toast.twitchRewardUpdated')
  }

  patch('twitch', { selectedRewardId: result.config.id })
  renderTwitchRewards()
  // the new reward is the one for the song requests: one message for both, not one for each
  toastSaveResult(await persistTwitchConfig(), 'toast.twitchRewardCreated')
}

export function bindTwitchRewardTracking() {
  trackForm(dom.twitchRewardSection)
  trackForm(dom.twitchRewardForm)
  dom.twitchAutoFulfillRedemptions.addEventListener('change', saveTwitchConfig)
}

export function bindTwitchRewardFormEvents() {
  dom.twitchCreateNewRewardBtn.addEventListener('click', () => {
    dom.twitchRewardSelect.value = ''
    patch('twitch', { selectedRewardId: '' })
    showRewardForm()
  })
  bindRewardForm()
}
