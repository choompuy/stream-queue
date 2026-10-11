import { escapeHtml, show, setError, setFieldState, setValue, setChecked } from '../shared.js'
import { api, ApiError } from './api.js'
import { state } from './state.js'
import { dom } from './dom.js'
import { CONFIG_FIELDS, OVERLAY_FIELDS } from './fields.js'
import { log } from './log.js'
import { run } from './run.js'
import { syncPlayer } from './player.js'
import { renderQueue } from './queue.js'
import { renderPlaylists } from './playlists.js'
import { t } from '../i18n.js'
import { toastError } from './toast.js'
import { reportSaveResult } from './save-result.js'

let qrCodePromise

function loadQRCode() {
  if (qrCodePromise) return qrCodePromise

  qrCodePromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'vendor/qrcode.min.js'
    script.onload = () => resolve(window.QRCode)
    script.onerror = reject
    document.head.appendChild(script)
  })

  return qrCodePromise
}

export function changeLocale(locale) {
  return run('changing locale', async () => {
    await api.updateSettings({ locale })
    location.reload()
  })
}

export function loadOverlaySettings() {
  return run('loading settings', async () => {
    state.settings = await api.getSettings()
    renderOverlayUrl()

    for (const field of OVERLAY_FIELDS) {
      const input = dom[field.dom]
      if (!input) continue

      setError(input, false)
      writeField(field, input, state.settings[field.key] ?? field.fallback)
    }

    syncHideOverlayInfoAvailability()
  })
}

export function syncHideOverlayInfoAvailability() {
  if (dom.hideOverlayInfo) dom.hideOverlayInfo.disabled = !dom.showVideo?.checked
}

export function saveOverlaySettings() {
  return run('saving settings', async () => {
    const changes = {}
    let valid = true

    for (const field of OVERLAY_FIELDS) {
      const input = dom[field.dom]
      if (!input) continue

      setError(input, false)

      const value = readOverlayField(field, input)
      if (Number.isNaN(value)) {
        setError(input)
        valid = false
      } else if (value !== state.settings[field.key]) {
        changes[field.key] = value
      }
    }

    if (!valid || Object.keys(changes).length === 0) return

    try {
      state.settings = await api.updateSettings(changes)
      syncPlayer()
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INVALID_SETTINGS' && error.params?.fields) {
        const rejectedFields = error.params.fields.split(', ')

        for (const field of OVERLAY_FIELDS) {
          if (rejectedFields.includes(field.key)) setError(dom[field.dom])
        }
      }
      throw error
    }
  })
}

function readOverlayField(field, input) {
  if (field.type === 'checkbox') return input.checked
  if (field.type === 'integer') return Number.parseInt(input.value, 10)
  return input.value
}

// puts a value into an input: a checkbox is checked, anything else gets the value
function writeField(field, input, value) {
  if (field.type === 'checkbox') setChecked(input, value)
  else setValue(input, value)
}

// The overlay only plays music when it is opened as localhost, and OBS runs on this computer: the link must say localhost
// even when the panel itself was opened by the computer's LAN address
export function renderOverlayUrl() {
  if (!dom.overlayUrl) return

  const url = `http://localhost${location.port ? `:${location.port}` : ''}/overlay`
  dom.overlayUrl.href = url
  dom.overlayUrl.textContent = url
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

    renderIpSelect()
    renderQrUrl()
  })
}

function renderIpSelect() {
  if (!dom.selectIp) return

  const ips = state.network?.ips ?? []
  show(dom.selectIp, ips.length > 1)
  if (ips.length <= 1) return

  dom.selectIp.innerHTML = ips
    .map((ip) => `<option value="${escapeHtml(ip)}" ${ip === state.selectedIp ? 'selected' : ''}>${escapeHtml(ip)}</option>`)
    .join('')
}

export async function renderQrUrl() {
  if (!dom.controlPanelQr || dom.controlPanelQr.classList.contains('hidden') || !state.selectedIp) return

  const QRCode = await loadQRCode()
  if (typeof QRCode === 'undefined') return

  const port = state.network?.port ?? location.port

  dom.controlPanelQr.innerHTML = ''
  new QRCode(dom.controlPanelQr, {
    text: `http://${state.selectedIp}${port ? `:${port}` : ''}`,
    width: 128,
    height: 128
  })
}

export function onIpChange() {
  state.selectedIp = dom.selectIp.value
  renderQrUrl()
}

export function toggleQr() {
  if (!dom.controlPanelQr) return

  const isHidden = dom.controlPanelQr.classList.contains('hidden')
  show(dom.controlPanelQr, isHidden)
  renderQrUrl()
}

export function loadConfig() {
  return run('loading config', async () => {
    state.config = await api.getConfig()
    applyConfig()
  })
}

// puts the stored config into the inputs and clears their changed/saved/error marks
function applyConfig() {
  for (const field of CONFIG_FIELDS) {
    const input = dom[field.dom]
    if (!input) continue
    setFieldState(input, null)

    writeField(field, input, storedFieldValue(field))
  }
}

export function cancelConfigChanges() {
  if (!state.config) return

  applyConfig()
  setValue(dom.secYoutubeKey, '')
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
    entries.push({ input, field, path: field.path ? `${field.path}.${field.key}` : field.key, changed: value !== storedFieldValue(field) })

    if (field.path) {
      config[field.path] ??= {}
      config[field.path][field.key] = value
    } else {
      config[field.key] = value
    }
  }

  const youtubeApiKey = dom.secYoutubeKey?.value.trim() ?? ''

  await run(
    'saving config',
    async () => {
      // partial save: the server stores every valid field and lists the refused ones
      const { config: saved, rejected } = await api.updateConfig(config)
      state.config = saved

      for (const { input, field, path } of entries) {
        if (rejected.includes(path)) continue

        writeField(field, input, storedFieldValue(field))
      }

      let apiKeyFailed = false

      if (youtubeApiKey) {
        try {
          await api.updateSecrets({ youtubeApiKey })
          dom.secYoutubeKey.value = ''
          await loadSecrets()
        } catch (error) {
          log('Error saving API key:', error)
          toastError(t('toast.apiKeyNotSaved'))
          apiKeyFailed = true
        }
      }

      renderQueue()
      renderPlaylists()
      reportSaveResult(entries, rejected, 'toast.settingsSaved', { successToast: !apiKeyFailed })
    },
    { button: dom.cfgSaveBtn }
  )
}

export const settingsActions = {
  'copy-overlay-url': copyOverlayUrl,
  'toggle-qr': toggleQr,
  'save-config': saveConfigSetting,
  'cancel-config': cancelConfigChanges
}
