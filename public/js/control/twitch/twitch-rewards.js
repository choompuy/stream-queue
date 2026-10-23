import { t } from '../../i18n.js'
import { api } from '../api.js'
import { run } from '../run.js'
import { state, on, patch } from '../state.js'
import { dom } from '../dom.js'
import { defineFormPanel, saveForm, toastSaveResult } from '../form.js'
import { showRewardForm } from './twitch-reward-form.js'

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
  const { rewards, selectedRewardId, config } = state.twitch

  select.replaceChildren(
    option(select, '', t(rewards.length ? 'settings.twitch.rewardNone' : 'settings.twitch.noRewards'), selectedRewardId === ''),
    ...rewards.map((reward) => option(select, reward.id, `${reward.title} (${reward.cost})`, reward.id === selectedRewardId))
  )

  // the options are new: what is stored is what they are measured against
  const stored = config?.channelPointsRewardId ?? ''
  for (const element of select.options) element.defaultSelected = element.value === stored
}

// the reward that is selected goes into the form, no reward selected is a blank form to create one
function showSelectedReward() {
  const { rewards, selectedRewardId, editingReward } = state.twitch

  if (selectedRewardId === '') return showRewardForm()

  const selected = rewards.find((reward) => reward.id === selectedRewardId)
  // a refill from under the person typing is worse than a stale form: while the form edits the selected reward it is
  // left alone, and a reward that vanished from the list keeps its form (the save will say what the server thinks)
  if (!selected || selected.id === editingReward?.id) return
  showRewardForm(selected)
}

// the rewards follow the twitch slice: whatever part of it changes (the connection, the config, the selection) is
// drawn by this one subscription, in the store's own turn
on('twitch', () => {
  renderRewardOptions()
  showSelectedReward()
})

async function readRewards() {
  patch('twitch', { rewards: (await api.getTwitchRewards()).rewards })
}

export async function loadTwitchRewards() {
  await readRewards()
}

export function onTwitchRewardChange() {
  patch('twitch', { selectedRewardId: dom.twitchRewardSelect.value })
  saveTwitchConfig()
}

export function applyRewardConfig(config) {
  patch('twitch', { selectedRewardId: config.channelPointsRewardId ?? '' })
  rewardSelection.fill(config)
}

// the selected reward and the auto-fulfil switch are saved at once, whenever one of them changes
const rewardSelection = defineFormPanel(dom.twitchRewardSection, {
  save: async (body) => {
    const answer = await api.updateTwitchConfig(body)
    patch('twitch', { config: answer.config })
    return answer
  },
  toastKey: 'toast.twitchSettingsSaved'
})

export function saveTwitchConfig() {
  return run('saving Twitch config', async () => rewardSelection.toastResult(await rewardSelection.saveChanges()))
}

// back to the reward as Twitch has it (or to a blank form while a new one is being created)
export function cancelRewardChanges() {
  showRewardForm(state.twitch.editingReward)
}

// the blank form of a new reward, away from the selection (the button is a data-action like any other)
export function createReward() {
  dom.twitchRewardSelect.value = ''
  patch('twitch', { selectedRewardId: '' })
  showRewardForm()
}

// a limit of a reward is its switch and its number: the server takes them as a pair, so one of them changing sends
// the whole limit, and a limit nobody touched is not sent at all
const REWARD_LIMIT_GROUPS = ['limits.maxPerStream', 'limits.maxPerUserPerStream', 'limits.globalCooldownSeconds']

export async function saveReward() {
  const editing = state.twitch.editingReward

  // an edit sends only what differs, so what was changed on twitch.tv in the meantime survives it; a creation sends
  // the form as it is typed
  const result = await saveForm(
    dom.twitchRewardForm,
    (body) => (editing ? api.updateTwitchReward(editing.id, body) : api.createTwitchReward(body)),
    editing ? { changedOnly: true, groups: REWARD_LIMIT_GROUPS } : {}
  )

  if (result.refused) return toastSaveResult(result, 'toast.twitchRewardUpdated')

  await readRewards()

  if (editing) {
    patch('twitch', { editingReward: result.config })
    return toastSaveResult(result, 'toast.twitchRewardUpdated')
  }

  // the new reward is the one for the song requests: one message for both, not one for each. The select is set
  // here as well: the save of the config reads it, and the drawing that follows the patch comes a turn later
  dom.twitchRewardSelect.value = result.config.id
  patch('twitch', { selectedRewardId: result.config.id })
  toastSaveResult(await rewardSelection.saveChanges(), 'toast.twitchRewardCreated')
}