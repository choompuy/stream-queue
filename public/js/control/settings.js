import { escapeHtml, show, setError, setFieldState, setValue, setChecked } from '../shared.js'
import { api, ApiError } from './api.js'
import { state, dom, log, CONFIG_FIELDS } from './state.js'
import { run } from './run.js'
import { syncPlayer } from './player.js'
import { renderQueue } from './queue.js'
import { renderPlaylists } from './playlists.js'
import { t } from '../i18n.js'
import { toastError } from './toast.js'
import { reportSaveResult } from './save-result.js'

export function changeLocale(locale) {
  return run('changing locale', async () => {
    await api.updateLocale(locale)
    location.reload()
  })
}

export function loadOverlaySettings() {
  return run('loading settings', async () => {
    state.settings = await api.getSettings()

    setError(dom.showVideo, false)
    setChecked(dom.showVideo, state.settings.showVideo)
    setError(dom.badgePosition, false)
    setValue(dom.badgePosition, state.settings.position || 'bottom-right')
  })
}

export function saveOverlaySettings() {
  return run('saving settings', async () => {
    setError(dom.showVideo, false)
    setError(dom.badgePosition, false)

    try {
      state.settings.showVideo = dom.showVideo?.checked ?? state.settings.showVideo
      state.settings.position = dom.badgePosition?.value ?? state.settings.position
      await api.updateSettings(state.settings)
      syncPlayer()
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INVALID_SETTINGS' && error.params?.fields) {
        const rejectedFields = error.params.fields.split(', ')

        if (rejectedFields.includes('showVideo')) setError(dom.showVideo)
        if (rejectedFields.includes('position')) setError(dom.badgePosition)
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
      show(dom.selectIp)
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
      show(dom.selectIp, false)
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

  show(dom.controlPanelQr, false)

  if (!dom.controlPanelQr.classList.contains('hidden')) renderQrUrl()
}

export function loadConfig() {
  return run('loading config', async () => {
    state.config = await api.getConfig()

    for (const field of CONFIG_FIELDS) {
      const input = dom[field.dom]
      if (!input) continue
      setFieldState(input, null)

      const value = storedFieldValue(field)

      if (field.type === 'checkbox') setChecked(input, value)
      else setValue(input, value)
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

function readFieldValue(field, input) {
  if (field.type === 'checkbox') return input.checked
  if (field.type === 'number') return Number(input.value)
  if (field.type === 'nullableText') return input.value.trim() || null
  return input.value.trim()
}

function storedFieldValue(field) {
  return field.path ? state.config?.[field.path]?.[field.key] : state.config?.[field.key]
}

export function isConfigFieldChanged(field) {
  const input = dom[field.dom]
  return Boolean(input) && readFieldValue(field, input) !== storedFieldValue(field)
}

export async function saveConfigSetting() {
  const config = {}
  const entries = []

  for (const field of CONFIG_FIELDS) {
    const input = dom[field.dom]
    if (!input) continue

    const value = readFieldValue(field, input)
    entries.push({ input, path: field.path ? `${field.path}.${field.key}` : field.key, changed: value !== storedFieldValue(field) })

    if (field.path) {
      config[field.path] ??= {}
      config[field.path][field.key] = value
    } else {
      config[field.key] = value
    }
  }

  const youtubeApiKey = dom.secYoutubeKey?.value.trim() ?? ''

  await run('saving config', async () => {
    // partial save: the server stores every valid field and lists the refused ones
    const { config: saved, rejected } = await api.updateConfig(config)
    state.config = saved

    for (const { input, path } of entries) {
      if (rejected.includes(path)) continue

      const field = CONFIG_FIELDS.find((f) => f.path ? `${f.path}.${f.key}` === path : f.key === path)
      if (!field) continue

      const serverValue = storedFieldValue(field)
      if (field.type === 'checkbox') setChecked(input, serverValue)
      else setValue(input, serverValue)
    }

    if (youtubeApiKey) {
      try {
        await api.updateSecrets({ youtubeApiKey })
        dom.secYoutubeKey.value = ''
        await loadSecrets()
      } catch (error) {
        log('Error saving API key:', error)
        toastError(t('toast.apiKeyNotSaved'))
      }
    }

    renderQueue()
    renderPlaylists()
    reportSaveResult(entries, rejected, 'toast.settingsSaved')
  })
}

export const settingsActions = {
  'copy-overlay-url': copyOverlayUrl,
  'toggle-qr': toggleQr,
  'save-config': saveConfigSetting
}
