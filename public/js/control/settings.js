import { escapeHtml, show, setValue } from '../shared.js'
import { api } from './api.js'
import { state, on, isLocalDevice } from './state.js'
import { dom } from './dom.js'
import { log } from './log.js'
import { run } from './run.js'
import { syncPlayer } from './player.js'
import { t } from '../i18n.js'
import { toastError, toastSuccess } from './toast.js'
import { fillForm, saveForm, toastSaveResult, formInputs, isChanged } from './form.js'
import { renderTwitchConnection } from './twitch/twitch-connection.js'

let qrCodePromise

function loadQRCode() {
  if (qrCodePromise) return qrCodePromise

  qrCodePromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'vendor/qrcode.min.js'
    script.onload = () => resolve(window.QRCode)
    script.onerror = () => {
      // a script that failed must not be remembered as the answer for good: the next try loads it again
      qrCodePromise = undefined
      script.remove()
      reject(new Error('The QR code script did not load'))
    }
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

// What the overlay settings answer is used for: the locale of the panel at startup, and the controls of the settings
// form itself — one read serves both, so the panel never asks for the settings twice in a row
export function applyOverlaySettings(settings) {
  state.settings = settings ?? {}
  renderOverlayUrl()
  fillForm(dom.overlaySettingsPanel, state.settings)
}

export function loadOverlaySettings() {
  return run('loading settings', async () => applyOverlaySettings(await api.getSettings()))
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

// The clipboard of the browser exists only on a page that is secure (localhost), not on the one opened by the LAN address: there the text is selected and copied
function copyBySelection(element) {
  const range = document.createRange()
  range.selectNodeContents(element)

  const selection = window.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)

  if (!document.execCommand('copy')) throw new Error('The copy command was refused')
}

export async function copyOverlayUrl() {
  try {
    if (navigator.clipboard) await navigator.clipboard.writeText(dom.overlayUrl.href)
    else copyBySelection(dom.overlayUrl)

    toastSuccess(t('toast.copied'))
  } catch (error) {
    log('Copy failed:', error)
    toastError(t('toast.copyFailed'))
  }
}

// One read of the secrets for everything they answer: whether the YouTube key is set (the status under the bot
// settings) and whether the Twitch client id is configured (the Twitch topic asks only once it is)
export function loadSecrets() {
  return run('loading secrets', async () => {
    const data = await api.getSecrets()

    state.secrets = data
    state.twitch = { ...state.twitch, configured: Boolean(data.twitch?.configured) }
    renderTwitchConnection()
  })
}

on('secrets', () => {
  const data = state.secrets
  const key = data?.hasYoutubeApiKey ? 'settings.bot.apiKeyConfigured' : 'settings.bot.apiKeyNotConfigured'

  dom.secretsStatus.textContent = t(key)
  dom.secretsStatus.setAttribute('data-i18n', key)
  dom.secretsStatus.classList.toggle('text-red', !data?.hasYoutubeApiKey)
})

export function loadNetworkInfo() {
  return run('loading network info', async () => {
    state.network = await api.getNetworkInfo()
    const { ips } = state.network

    if (!ips.length) state.selectedIp = 'localhost'
    else if (!state.selectedIp || !ips.includes(state.selectedIp)) state.selectedIp = ips[0]
  })
}

// the address that the QR code and the "not this computer" hints follow: the network info and whichever of its
// addresses was chosen
on(['network', 'selectedIp'], () => {
  applyDeviceLocality()
  if (!state.network) return

  renderIpSelect()
  renderQrUrl()
})

export function applyDeviceLocality() {
  document.body.classList.toggle('not-local', !isLocalDevice())
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

  let QRCode

  try {
    QRCode = await loadQRCode()
  } catch (error) {
    log('QR code failed to load:', error)
    return
  }

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
}

export function toggleQr() {
  const isHidden = dom.controlPanelQr.classList.contains('hidden')
  show(dom.controlPanelQr, isHidden)
  renderQrUrl()
}

// The config topic: read while the settings page is shown. The stored values go into the form, except the fields
// the person is editing right now — their answer would be older than what was typed since (K12)
export function loadConfig() {
  return run('loading config', async () => {
    state.config = await api.getConfig()
    const editing = formInputs(dom.botSettingsPanel)
      .filter(isChanged)
      .map((input) => input.name)
    fillForm(dom.botSettingsPanel, state.config, { skip: editing, keepMarks: true })
  })
}

export function cancelConfigChanges() {
  if (!state.config) return

  fillForm(dom.botSettingsPanel, state.config)
  setValue(dom.secYoutubeKey, '')
}

export async function saveConfigSetting() {
  const youtubeApiKey = dom.secYoutubeKey.value.trim()

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

  toastSaveResult(result, 'toast.settingsSaved', { successToast: !apiKeyFailed })
}

export const settingsActions = {
  'copy-overlay-url': copyOverlayUrl,
  'toggle-qr': toggleQr,
  'save-config': saveConfigSetting,
  'cancel-config': cancelConfigChanges
}
