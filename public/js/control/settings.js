import { escapeHtml } from '../shared.js'
import { api } from './api.js'
import { state, dom, log, CONFIG_FIELDS } from './state.js'
import { syncPlayer } from './player.js'
import { renderQueue } from './queue.js'
import { renderPlaylists } from './playlists.js'
import { setLocale, getCurrentLocale, updateDomTranslations, t } from '../i18n.js'

export async function syncLocaleFromServer() {
  try {
    const data = await api.getLocale()
    const serverLocale = data.locale || 'ru'
    const currentLocale = getCurrentLocale()

    if (serverLocale !== currentLocale) {
      await setLocale(serverLocale)
    }
  } catch (error) {
    log('Error syncing locale from server:', error)
  }
}

export async function changeLocale(locale) {
  try {
    await api.updateLocale(locale)
    await setLocale(locale)
    updateDomTranslations()
    location.reload()
  } catch (error) {
    log('Error changing locale:', error)
  }
}

export async function loadPreviewSettings() {
  try {
    state.settings = await api.getSettings()

    if (dom.showVideo) dom.showVideo.checked = Boolean(state.settings.showVideo)
    if (dom.badgePosition) dom.badgePosition.value = state.settings.position || 'bottom-right'
    if (dom.localeSelect) dom.localeSelect.value = state.settings.locale || 'ru'
  } catch (error) {
    log('Error loading settings:', error)
  }
}

export async function savePreviewSettings() {
  try {
    state.settings.showVideo = dom.showVideo.checked
    state.settings.position = dom.badgePosition ? dom.badgePosition.value : state.settings.position
    await api.updateSettings(state.settings)
    syncPlayer()
  } catch (error) {
    log('Error saving settings:', error)
  }
}

export function copyPreviewUrl() {
  if (!dom.previewUrl) return

  navigator.clipboard?.writeText(dom.previewUrl.href).catch((error) => {
    log('Copy failed:', error)
  })
}

export async function loadNetworkInfo() {
  try {
    state.network = await api.getNetworkInfo()
    const ips = state.network?.ips ?? []

    if (!ips.length) state.selectedIp = 'localhost'
    else if (!state.selectedIp || !ips.includes(state.selectedIp)) state.selectedIp = ips[0]

    renderQrUrl()
  } catch (error) {
    log('Error loading network info:', error)
  }
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

export async function loadConfig() {
  try {
    state.config = await api.getConfig()

    for (const field of CONFIG_FIELDS) {
      const input = dom[field.dom]
      if (!input) continue

      const value = field.path ? state.config[field.path]?.[field.key] : state.config[field.key]
      input.value = value ?? ''
    }
  } catch (error) {
    log('Error loading config:', error)
  }
}

export async function loadSecrets() {
  try {
    const data = await api.getSecrets()
    const key = data.hasYoutubeApiKey ? 'settings.bot.apiKeyConfigured' : 'settings.bot.apiKeyNotConfigured'
    dom.secretsStatus.textContent = t(key)
    dom.secretsStatus.setAttribute('data-i18n', key)
    dom.secretsStatus.classList.toggle('text-red', !data.hasYoutubeApiKey)
  } catch (error) {
    log('Error loading secrets:', error)
  }
}

export async function saveConfigSetting() {
  const config = {}

  for (const field of CONFIG_FIELDS) {
    const input = dom[field.dom]
    if (!input) continue

    const value = field.type === 'number' ? Number(input.value) : input.value.trim()

    if (field.path) {
      config[field.path] ??= {}
      config[field.path][field.key] = value
    } else {
      config[field.key] = value
    }
  }

  const youtubeApiKey = dom.secYoutubeKey.value.trim()

  try {
    state.config = await api.updateConfig(config)

    if (youtubeApiKey) {
      await api.updateSecrets({ youtubeApiKey })
      dom.secYoutubeKey.value = ''
      await loadSecrets()
    }

    renderQueue()
    renderPlaylists()
  } catch (error) {
    log('Error saving settings:', error)
  }
}
