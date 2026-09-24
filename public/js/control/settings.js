import { escapeHtml } from '../shared.js'
import { api, ApiError } from './api.js'
import { state, dom, log, CONFIG_FIELDS } from './state.js'
import { run } from './run.js'
import { syncPlayer } from './player.js'
import { renderQueue } from './queue.js'
import { renderPlaylists } from './playlists.js'
import { t } from '../i18n.js'
import { toastSuccess } from './toast.js'

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
      state.settings.showVideo = dom.showVideo.checked
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
  })
}

export function loadSecrets() {
  return run('loading secrets', async () => {
    const data = await api.getSecrets()
    const key = data.hasYoutubeApiKey ? 'settings.bot.apiKeyConfigured' : 'settings.bot.apiKeyNotConfigured'
    dom.secretsStatus.textContent = t(key)
    dom.secretsStatus.setAttribute('data-i18n', key)
    dom.secretsStatus.classList.toggle('text-red', !data.hasYoutubeApiKey)
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
    else value = input.value.trim()

    if (field.path) {
      config[field.path] ??= {}
      config[field.path][field.key] = value
    } else {
      config[field.key] = value
    }
  }

  const youtubeApiKey = dom.secYoutubeKey.value.trim()

  await run('saving config', async () => {
    try {
      state.config = await api.updateConfig(config)

      if (youtubeApiKey) {
        await api.updateSecrets({ youtubeApiKey })
        dom.secYoutubeKey.value = ''
        await loadSecrets()
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

          const fieldName = field.key
          if (rejectedFields.includes(fieldName)) {
            input.classList.add('error')
          }
        }
      }
      throw error
    }
  })
}

export const settingsActions = {
  'copy-overlay-url': copyOverlayUrl,
  'toggle-qr': toggleQr,
  'save-config': saveConfigSetting
}
