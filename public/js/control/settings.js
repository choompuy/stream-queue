import { escapeHtml } from '../shared.js'
import { api, ApiError } from './api.js'
import { state, dom, log, CONFIG_FIELDS } from './state.js'
import { run } from './run.js'
import { syncPlayer } from './player.js'
import { renderQueue } from './queue.js'
import { renderPlaylists } from './playlists.js'
import { t } from '../i18n.js'
import { toastSuccess, toastError } from './toast.js'

export function changeLocale(locale) {
  return run('changing locale', async () => {
    await api.updateLocale(locale)
    location.reload()
  })
}

export function loadOverlaySettings() {
  return run('loading settings', async () => {
    state.settings = await api.getSettings()

    if (dom.showVideo) {
      dom.showVideo.classList.remove('error')
      dom.showVideo.checked = Boolean(state.settings.showVideo)
    }
    if (dom.badgePosition) {
      dom.badgePosition.classList.remove('error')
      dom.badgePosition.value = state.settings.position || 'bottom-right'
    }
  })
}

export function saveOverlaySettings() {
  return run('saving settings', async () => {
    if (dom.showVideo) dom.showVideo.classList.remove('error')
    if (dom.badgePosition) dom.badgePosition.classList.remove('error')

    try {
      state.settings.showVideo = dom.showVideo ? dom.showVideo.checked : state.settings.showVideo
      state.settings.position = dom.badgePosition ? dom.badgePosition.value : state.settings.position
      await api.updateSettings(state.settings)
      syncPlayer()
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INVALID_SETTINGS' && error.params?.fields) {
        const rejectedFields = error.params.fields.split(', ')

        if (rejectedFields.includes('showVideo') && dom.showVideo) {
          dom.showVideo.classList.add('error')
        }
        if (rejectedFields.includes('position') && dom.badgePosition) {
          dom.badgePosition.classList.add('error')
        }
      }
      throw error
    }
  })
}

export function copyOverlayUrl() {
  if (!dom.overlayUrl) return

  navigator.clipboard?.writeText(dom.overlayUrl.href).catch((error) => {
    log('Copy failed:', error)
  })
}

export function loadNetworkInfo() {
  return run('loading network info', async () => {
    state.network = await api.getNetworkInfo()
    const ips = state.network?.ips ?? []

    if (!ips.length) state.selectedIp = 'localhost'
    else if (!state.selectedIp || !ips.includes(state.selectedIp)) state.selectedIp = ips[0]

    renderQrUrl()
  })
}

export function renderQrUrl() {
  const host = state.selectedIp === 'localhost' ? 'localhost' : state.selectedIp
  const port = state.network?.port ?? location.port
  const url = `http://${host}${port ? `:${port}` : ''}`

  if (dom.selectIp) {
    const ips = state.network?.ips ?? []
    if (ips.length > 1) {
      dom.selectIp.classList.remove('hidden')
      dom.selectIp.innerHTML = ips
        .map(
          (ip) => `
            <option value="${escapeHtml(ip)}" ${ip === state.selectedIp ? 'selected' : ''}>
              ${escapeHtml(ip)}
            </option>
          `
        )
        .join('')
    } else {
      dom.selectIp.classList.add('hidden')
    }
  }

  if (dom.controlPanelQr && !dom.controlPanelQr.classList.contains('hidden')) {
    if (typeof QRCode === 'undefined') return

    dom.controlPanelQr.innerHTML = ''
    new QRCode(dom.controlPanelQr, {
      text: url,
      width: 128,
      height: 128
    })
  }
}

export function onIpChange() {
  state.selectedIp = dom.selectIp.value
  renderQrUrl()
}

export function toggleQr() {
  if (!dom.controlPanelQr) return

  dom.controlPanelQr.classList.toggle('hidden')

  if (!dom.controlPanelQr.classList.contains('hidden')) renderQrUrl()
}

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

        if (dom.twitchAuthorizationCode) {
          dom.twitchAuthorizationCode.textContent = response.userCode
        }

        dom.twitchAuthorization?.classList.remove('hidden')
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
            dom.twitchAuthorization?.classList.add('hidden')
            renderTwitchConnection()
            await loadTwitchRewards()
            return
          }
        }

        dom.twitchAuthorization?.classList.add('hidden')
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
    dom.twitchAuthorization?.classList.add('hidden')
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

function renderTwitchConnection() {
  if (!dom.twitchConnectionStatus) return

  if (!state.twitch.configured) {
    dom.twitchNotConfigured?.classList.remove('hidden')
    dom.twitchConnectionControls?.classList.add('hidden')
    dom.twitchAuthorization?.classList.add('hidden')
    dom.twitchRewardSection?.classList.add('hidden')
    dom.twitchSaveBtn?.classList.add('hidden')
    return
  }

  dom.twitchNotConfigured?.classList.add('hidden')
  dom.twitchConnectionControls?.classList.remove('hidden')

  if (state.twitch.connected && state.twitch.user) {
    dom.twitchConnectionStatus.textContent = t('settings.twitch.connected', { user: state.twitch.user.displayName })
    dom.twitchConnectionStatus.classList.remove('text-red')
    dom.twitchConnectBtn?.classList.add('hidden')
    dom.twitchDisconnectBtn?.classList.remove('hidden')
    dom.twitchRewardSection?.classList.remove('hidden')
    dom.twitchSaveBtn.classList.remove('hidden')
  } else {
    dom.twitchConnectionStatus.textContent = t('settings.twitch.notConnected')
    dom.twitchConnectionStatus.classList.add('text-red')
    dom.twitchConnectBtn?.classList.remove('hidden')
    dom.twitchDisconnectBtn?.classList.add('hidden')
    dom.twitchRewardSection?.classList.add('hidden')
    dom.twitchSaveBtn.classList.add('hidden')
  }
}

export function renderTwitchRewards() {
  if (!dom.twitchRewardSelect) return

  if (!state.twitch.rewards.length) {
    dom.twitchRewardSelect.innerHTML = `<option value="">${escapeHtml(t('settings.twitch.noRewards'))}</option>`
    return
  }

  const selectedId = state.twitch.selectedRewardId ?? ''

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

// the reward id lives in state, not in the <select>, so it survives a config load that happens
// before the reward options exist
export function onTwitchRewardChange() {
  state.twitch.selectedRewardId = dom.twitchRewardSelect?.value ?? ''
}

export function loadConfig() {
  return run('loading config', async () => {
    state.config = await api.getConfig()

    for (const field of CONFIG_FIELDS) {
      const input = dom[field.dom]
      if (!input) continue
      input.classList.remove('error')

      const value = field.path ? state.config[field.path]?.[field.key] : state.config[field.key]

      if (field.type === 'checkbox') input.checked = Boolean(value)
      else input.value = value ?? ''
    }

    state.twitch.selectedRewardId = state.config?.twitch?.channelPointsRewardId ?? ''
    renderTwitchRewards()
  })
}

export function loadSecrets() {
  return run('loading secrets', async () => {
    const data = await api.getSecrets()
    const key = data.hasYoutubeApiKey ? 'settings.bot.apiKeyConfigured' : 'settings.bot.apiKeyNotConfigured'
    dom.secretsStatus.textContent = t(key)
    dom.secretsStatus.setAttribute('data-i18n', key)
    dom.secretsStatus.classList.toggle('text-red', !data.hasYoutubeApiKey)

    state.twitch.configured = Boolean(data.twitch?.configured)
    renderTwitchConnection()
  })
}

export async function saveConfigSetting() {
  const config = {}

  for (const field of CONFIG_FIELDS) {
    const input = dom[field.dom]
    if (!input) continue
    input.classList.remove('error')

    let value

    if (field.type === 'checkbox') value = input.checked
    else if (field.type === 'number') value = Number(input.value)
    else if (field.type === 'nullableText') value = input.value.trim() || null
    else value = input.value.trim()

    if (field.path) {
      config[field.path] ??= {}
      config[field.path][field.key] = value
    } else {
      config[field.key] = value
    }
  }

  const youtubeApiKey = dom.secYoutubeKey?.value.trim() ?? ''

  await run('saving config', async () => {
    try {
      state.config = await api.updateConfig(config)

      if (youtubeApiKey) {
        try {
          await api.updateSecrets({ youtubeApiKey })
          dom.secYoutubeKey.value = ''
          await loadSecrets()
        } catch (error) {
          toastError(t('toast.apiKeyNotSaved') ?? 'Config saved, but API key was not')
          throw error
        }
      }

      renderQueue()
      renderPlaylists()
      toastSuccess(t('toast.settingsSaved'))
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INVALID_CONFIG' && error.params?.fields) {
        const rejectedFields = error.params.fields.split(', ')

        for (const field of CONFIG_FIELDS) {
          const input = dom[field.dom]
          if (!input) continue

          // the backend reports rejected fields as dotted names (e.g. "twitch.channelPointsRewardId"),
          // so the comparison must match that shape rather than the bare field key
          const fieldName = field.path ? `${field.path}.${field.key}` : field.key
          if (rejectedFields.includes(fieldName)) {
            input.classList.add('error')
          }
        }

        // the backend is all-or-nothing: any invalid field means nothing was saved, so this must
        // never read as a success regardless of how many fields were rejected
        toastError(t('toast.settingsNotSaved', { rejected: rejectedFields.length, total: CONFIG_FIELDS.length }))
      }
      throw error
    }
  })
}

export async function saveTwitchConfig() {
  const config = {
    twitch: {
      channelPointsRewardId: state.twitch.selectedRewardId || null
    }
  }

  if (dom.twitchRewardSelect) {
    dom.twitchRewardSelect.classList.remove('error')
  }

  await run('saving Twitch config', async () => {
    try {
      state.config = await api.updateConfig(config)
      toastSuccess(t('toast.twitchSettingsSaved'))
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INVALID_CONFIG' && error.params?.fields) {
        const rejectedFields = error.params.fields.split(', ')

        if (rejectedFields.includes('twitch.channelPointsRewardId') && dom.twitchRewardSelect) {
          dom.twitchRewardSelect.classList.add('error')
        }
      }
      throw error
    }
  })
}

export const settingsActions = {
  'copy-overlay-url': copyOverlayUrl,
  'toggle-qr': toggleQr,
  'save-config': saveConfigSetting,
  'save-twitch-config': saveTwitchConfig,
  'connect-twitch': connectTwitch,
  'disconnect-twitch': disconnectTwitch
}
