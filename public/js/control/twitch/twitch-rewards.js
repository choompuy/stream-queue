import { setChecked, setFieldState, setValue } from '../../shared.js'
import { t } from '../../i18n.js'
import { api } from '../api.js'
import { run } from '../run.js'
import { state } from '../state.js'
import { dom } from '../dom.js'
import { reportSaveResult, trackChanges } from '../save-result.js'
import { toastSuccess } from '../toast.js'
import { showRewardForm, markRewardSaved, readRewardForm, bindRewardForm } from './twitch-reward-form.js'

export async function loadTwitchRewards() {
  const response = await api.getTwitchRewards()
  state.twitch.rewards = response?.rewards ?? []
  renderTwitchRewards()
}

function option(select, value, text, selected = false) {
  const element = select.ownerDocument.createElement('option')
  element.value = value
  element.textContent = text
  element.selected = selected
  return element
}

// no reward selected -> blank form to create one, a known reward -> the form filled with it
function showSelectedReward() {
  const id = state.twitch.selectedRewardId ?? ''
  const reward = state.twitch.rewards.find((r) => r.id === id)

  if (!id) showRewardForm()
  else if (reward) showRewardForm(reward)
}

export function renderTwitchRewards() {
  const select = dom.twitchRewardSelect
  if (!select) return

  const { rewards, selectedRewardId } = state.twitch

  if (!rewards.length) {
    select.replaceChildren(option(select, '', t('settings.twitch.noRewards')))
    showRewardForm()
    return
  }

  showSelectedReward()
  select.replaceChildren(
    option(select, '', t('settings.twitch.rewardNone')),
    ...rewards.map((reward) => option(select, reward.id, `${reward.title} (${reward.cost})`, reward.id === selectedRewardId))
  )
}

export function onTwitchRewardChange() {
  state.twitch.selectedRewardId = dom.twitchRewardSelect?.value ?? ''
  showSelectedReward()
  saveTwitchConfig()
}

export function applyRewardConfig(config) {
  state.twitch.selectedRewardId = config?.channelPointsRewardId ?? ''
  state.twitch.savedRewardId = state.twitch.selectedRewardId
  state.twitch.savedAutoFulfillRedemptions = config?.autoFulfillRedemptions ?? false
  renderTwitchRewards()
  setFieldState(dom.twitchRewardSelect, null)
  setChecked(dom.twitchAutoFulfillRedemptions, state.twitch.savedAutoFulfillRedemptions)
  setFieldState(dom.twitchAutoFulfillRedemptions, null)
}

export async function saveTwitchConfig() {
  const rewardId = state.twitch.selectedRewardId || ''
  const autoFulfillRedemptions = dom.twitchAutoFulfillRedemptions?.checked ?? false
  const entries = [
    { input: dom.twitchRewardSelect, path: 'channelPointsRewardId', changed: rewardId !== state.twitch.savedRewardId },
    {
      input: dom.twitchAutoFulfillRedemptions,
      path: 'autoFulfillRedemptions',
      changed: autoFulfillRedemptions !== state.twitch.savedAutoFulfillRedemptions
    }
  ]

  await run('saving Twitch config', async () => {
    const { config, rejected } = await api.updateTwitchConfig({ channelPointsRewardId: rewardId || null, autoFulfillRedemptions })

    state.twitch.savedRewardId = config.channelPointsRewardId ?? ''
    state.twitch.savedAutoFulfillRedemptions = config.autoFulfillRedemptions ?? false
    reportSaveResult(entries, rejected, 'toast.twitchSettingsSaved')
  })
}

// back to the reward as Twitch has it (or to a blank form while a new one is being created)
export function cancelRewardChanges() {
  showRewardForm(state.twitch.editingReward)
}

export async function saveReward() {
  const data = readRewardForm()
  if (!data) return

  const previous = state.twitch.editingReward
  const isEdit = Boolean(previous)

  await run(
    isEdit ? 'updating Twitch reward' : 'creating Twitch reward',
    async () => {
      const response = isEdit ? await api.updateTwitchReward(previous.id, data) : await api.createTwitchReward(data)
      if (!response?.reward) return

      await loadTwitchRewards()

      if (isEdit) {
        markRewardSaved(response.reward, previous)
        toastSuccess(t('toast.twitchRewardUpdated'))
        return
      }

      state.twitch.selectedRewardId = response.reward.id
      renderTwitchRewards()
      await saveTwitchConfig()
      toastSuccess(t('toast.twitchRewardCreated'))
    },
    { button: dom.twitchSaveRewardBtn }
  )
}

export function bindTwitchRewardTracking() {
  trackChanges(dom.twitchRewardSelect, () => dom.twitchRewardSelect.value !== state.twitch.savedRewardId)
  trackChanges(dom.twitchAutoFulfillRedemptions, () => dom.twitchAutoFulfillRedemptions.checked !== state.twitch.savedAutoFulfillRedemptions)
  dom.twitchAutoFulfillRedemptions?.addEventListener('change', saveTwitchConfig)
}

export function bindTwitchRewardFormEvents() {
  dom.twitchCreateNewRewardBtn?.addEventListener('click', () => {
    setValue(dom.twitchRewardSelect, '')
    state.twitch.selectedRewardId = ''
    showRewardForm()
  })
  bindRewardForm()
}
