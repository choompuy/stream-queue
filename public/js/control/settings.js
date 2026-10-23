import { show, setValue, setFieldState } from '../shared.js'
import { api } from './api.js'
import { store, state, on, patch, isLocalDevice } from './state.js'
import { dom } from './dom.js'
import { log } from './log.js'
import { run, reportError } from './run.js'
import { syncPlayer } from './player.js'
import { t, loadTranslations, updateDomTranslations } from '../i18n.js'
import { toastError, toastSuccess } from './toast.js'
import { defineFormPanel } from './form.js'

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

    // the page is redrawn in the new language where it stands: the lists and the cards follow the store, the rest is
    // written in data-i18n. Unsaved text (what is being typed) is not touched by any of it
    await loadTranslations(locale)
    document.documentElement.lang = locale
    updateDomTranslations()
    store.refresh()
  })
}

// What the overlay settings answer is used for: the locale of the panel at startup, and the controls of the settings
// form itself — one read serves both, so the panel never asks for the settings twice in a row
export function applyOverlaySettings(settings) {
  state.settings = settings ?? {}
}

// the drawings that follow the settings: the OBS link, the player, and the form that edits them
on('settings', () => {
  renderOverlayUrl()
  overlaySettings.fill(state.settings)
  syncPlayer()
})

// the overlay settings are saved at once, whenever one of them changes
const overlaySettings = defineFormPanel(dom.overlaySettingsPanel, {
  save: async (body) => {
    const answer = await api.updateSettings(body)
    state.settings = answer.config
    return answer
  },
  toastKey: 'toast.settingsSaved'
})

export function saveOverlaySettings() {
  // an autosave is silent: the green mark on the field is enough
  return run('saving settings', async () => overlaySettings.toastResult(await overlaySettings.saveChanges(), { successToast: false }))
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
    patch('twitch', { configured: Boolean(data.twitch?.configured) })
  })
}

on('secrets', () => {
  const data = state.secrets
  const key = data?.hasYoutubeApiKey ? 'settings.bot.apiKeyConfigured' : 'settings.bot.apiKeyNotConfigured'

  dom.secretsStatus.textContent = t(key)
  dom.secretsStatus.setAttribute('data-i18n', key)
  dom.secretsStatus.classList.toggle('text-red', !data?.hasYoutubeApiKey)
})

export function loadNetworkInfo({ silent = false } = {}) {
  return run(
    'loading network info',
    async () => {
      state.network = await api.getNetworkInfo()
      const { ips } = state.network

      if (!ips.length) state.selectedIp = 'localhost'
      else if (!state.selectedIp || !ips.includes(state.selectedIp)) state.selectedIp = ips[0]
    },
    { silent }
  )
}

// the address that the QR code and the "not this computer" hints follow: the network info and whichever of its
// addresses was chosen
on(['network', 'selectedIp'], () => {
  applyDeviceLocality()
  if (!state.network) return

  renderIpSelect()
  renderQrUrl()
})

function applyDeviceLocality() {
  document.body.classList.toggle('not-local', !isLocalDevice())
}

function renderIpSelect() {
  const { ips } = state.network
  show(dom.selectIp, ips.length > 1)
  if (ips.length <= 1) return

  dom.selectIp.replaceChildren(
    ...ips.map((ip) => {
      const element = document.createElement('option')
      element.value = ip
      element.textContent = ip
      element.selected = ip === state.selectedIp
      return element
    })
  )
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

function toggleQr() {
  const isHidden = dom.controlPanelQr.classList.contains('hidden')
  show(dom.controlPanelQr, isHidden)
  renderQrUrl()
}

// The config topic: read while the settings page is shown; the panel is filled with what it learned
const botSettings = defineFormPanel(dom.botSettingsPanel, {
  save: async (body) => {
    const answer = await api.updateConfig(body)
    state.config = answer.config
    return answer
  },
  stored: () => state.config,
  toastKey: 'toast.settingsSaved'
})

export function readConfig() {
  return run('loading config', async () => {
    state.config = await api.getConfig()
    botSettings.fill(state.config)
  })
}

export function cancelConfigChanges() {
  if (!state.config) return

  botSettings.cancel()
  setValue(dom.secYoutubeKey, '')
}

// The key is not part of the config form (the server keeps secrets apart): it is saved next to it, and its failure
// is told on its own — with the server's own words — while the field holds the error until it is typed in again
async function saveYoutubeApiKey(key) {
  try {
    await api.updateSecrets({ youtubeApiKey: key })
    dom.secYoutubeKey.value = ''
    setFieldState(dom.secYoutubeKey, null)
    await loadSecrets()
    return true
  } catch (error) {
    log('Error saving API key:', error)
    setFieldState(dom.secYoutubeKey, 'error')
    reportError(error)
    return false
  }
}

export async function saveConfigSetting() {
  const youtubeApiKey = dom.secYoutubeKey.value.trim()
  const keySaved = youtubeApiKey ? await saveYoutubeApiKey(youtubeApiKey) : true

  botSettings.toastResult(await botSettings.saveChanges(), { successToast: keySaved })
}

export const settingsActions = {
  'copy-overlay-url': copyOverlayUrl,
  'toggle-qr': toggleQr,
  'save-config': saveConfigSetting,
  'cancel-config': cancelConfigChanges
}
