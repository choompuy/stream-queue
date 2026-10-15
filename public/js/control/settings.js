import { escapeHtml, show, setValue } from '../shared.js'
import { api } from './api.js'
import { state } from './state.js'
import { dom } from './dom.js'
import { log } from './log.js'
import { run } from './run.js'
import { syncPlayer } from './player.js'
import { renderQueue } from './queue.js'
import { t } from '../i18n.js'
import { toastError } from './toast.js'
import { fillForm, saveForm, toastSaveResult } from './form.js'

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
    fillForm(dom.overlaySettingsPanel, state.settings)
  })
}

// the overlay settings are saved at once, whenever one of them changes
export function saveOverlaySettings() {
  return run('saving settings', async () => {
    const result = await saveForm(
      dom.overlaySettingsPanel,
      async (body) => {
        const answer = await api.updateSettings(body)
        state.settings = answer.config
        return answer
      },
      { changedOnly: true }
    )

    syncPlayer()
    toastSaveResult(result, 'toast.settingsSaved', { successToast: false })
  })
}

// The overlay only plays music when it is opened as localhost, and OBS runs on this computer: the link must say localhost
// even when the panel itself was opened by the computer's LAN address
export function renderOverlayUrl() {
  const url = `http://localhost${location.port ? `:${location.port}` : ''}/overlay`
  dom.overlayUrl.href = url
  dom.overlayUrl.textContent = url
}

export function copyOverlayUrl() {
  navigator.clipboard?.writeText(dom.overlayUrl.href).catch((error) => {
    log('Copy failed:', error)
  })
}

export function loadNetworkInfo() {
  return run('loading network info', async () => {
    state.network = await api.getNetworkInfo()
    const { ips } = state.network

    if (!ips.length) state.selectedIp = 'localhost'
    else if (!state.selectedIp || !ips.includes(state.selectedIp)) state.selectedIp = ips[0]

    renderIpSelect()
    renderQrUrl()
  })
}

function renderIpSelect() {
  const { ips } = state.network
  show(dom.selectIp, ips.length > 1)
  if (ips.length <= 1) return

  dom.selectIp.innerHTML = ips
    .map((ip) => `<option value="${escapeHtml(ip)}" ${ip === state.selectedIp ? 'selected' : ''}>${escapeHtml(ip)}</option>`)
    .join('')
}

export async function renderQrUrl() {
  if (dom.controlPanelQr.classList.contains('hidden') || !state.selectedIp) return

  const QRCode = await loadQRCode()
  if (typeof QRCode === 'undefined') return

  const { port } = state.network

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
  const isHidden = dom.controlPanelQr.classList.contains('hidden')
  show(dom.controlPanelQr, isHidden)
  renderQrUrl()
}

export function loadConfig() {
  return run('loading config', async () => {
    state.config = await api.getConfig()
    fillForm(dom.botSettingsPanel, state.config)
  })
}

export function cancelConfigChanges() {
  if (!state.config) return

  fillForm(dom.botSettingsPanel, state.config)
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

export function saveConfigSetting() {
  const youtubeApiKey = dom.secYoutubeKey.value.trim()

  return run('saving config', async () => {
    // partial save: the server stores every valid field and lists the refused ones
    const result = await saveForm(
      dom.botSettingsPanel,
      async (config) => {
        const answer = await api.updateConfig(config)
        state.config = answer.config
        return answer
      },
      { changedOnly: true }
    )

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
    toastSaveResult(result, 'toast.settingsSaved', { successToast: !apiKeyFailed })
  })
}

export const settingsActions = {
  'copy-overlay-url': copyOverlayUrl,
  'toggle-qr': toggleQr,
  'save-config': saveConfigSetting,
  'cancel-config': cancelConfigChanges
}
