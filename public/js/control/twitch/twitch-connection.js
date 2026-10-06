import { show, setText, setClass } from '../../shared.js'
import { t } from '../../i18n.js'
import { api, ApiError } from '../api.js'
import { run } from '../run.js'
import { state, log } from '../state.js'
import { dom } from '../dom.js'
import { loadTwitchRewards, renderTwitchRewards } from './twitch-rewards.js'

const POLL_INTERVAL_MS = 2000

const UNHEALTHY_POLLS_BEFORE_WARNING = 2

let pollController = null

export function stopTwitchPolling() {
  pollController?.abort()
  pollController = null
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

function isUnhealthy(health) {
  return Boolean(health) && (health.auth === 'reauthorize' || !health.eventSub || !health.chat)
}

// no status -> disconnected
function applyStatus(status) {
  state.twitch.connected = Boolean(status?.connected)
  state.twitch.user = status?.user ?? null
  state.twitch.connectedAt = status?.connectedAt ?? null
  state.twitch.health = status?.health ?? null
  state.twitch.unhealthyPolls = isUnhealthy(state.twitch.health) ? 1 : 0
}

export function refreshTwitchHealth() {
  return run(
    'refreshing Twitch status',
    async () => {
      if (!state.twitch.configured || !state.twitch.connected) return

      const status = await api.getTwitchStatus()

      if (!status.connected) {
        applyStatus(null)
        renderTwitchConnection()
        return
      }

      state.twitch.health = status.health ?? null
      state.twitch.unhealthyPolls = isUnhealthy(state.twitch.health) ? state.twitch.unhealthyPolls + 1 : 0
      renderTwitchHealth(true)
    },
    { silent: true }
  )
}

export function connectTwitch() {
  // opened up-front so the popup is attributed to the click and not to the API response
  const authWindow = openAuthorizationWindow()

  stopTwitchPolling()
  const controller = new AbortController()
  pollController = controller
  const { signal } = controller

  return run(
    'connecting Twitch',
    async () => {
      let navigated = false

      try {
        const response = await api.connectTwitch()

        if (!response?.verificationUri || !response?.userCode) {
          throw new ApiError('Twitch authorization data is missing', { code: 'TWITCH_AUTH_ERROR' })
        }

        if (signal.aborted) return

        setText(dom.twitchAuthorizationCode, response.userCode)
        show(dom.twitchAuthorization)
        navigateAuthorizationWindow(authWindow, response.verificationUri)
        navigated = true
        const expiresAt = Date.now() + response.expiresIn * 1000

        while (Date.now() < expiresAt) {
          if (!(await delay(POLL_INTERVAL_MS, signal))) return

          const status = await api.getTwitchStatus()
          if (signal.aborted) return

          if (status.connected) {
            applyStatus(status)
            show(dom.twitchAuthorization, false)
            renderTwitchConnection()
            await loadTwitchRewards()
            return
          }
        }

        show(dom.twitchAuthorization, false)
        throw new ApiError('Twitch authorization expired', { code: 'TWITCH_AUTH_EXPIRED' })
      } finally {
        // the popup was opened before the request, so it is closed on every path that never sent it to Twitch
        if (!navigated) authWindow?.close()
        if (pollController === controller) pollController = null
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
    applyStatus(null)
    state.twitch.rewards = []
    show(dom.twitchAuthorization, false)
    show(dom.twitchRewardForm, false)
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

    applyStatus(await api.getTwitchStatus())
    renderTwitchConnection()

    if (state.twitch.connected) await loadTwitchRewards()
  })
}

export function loadTwitchSecrets() {
  return run('loading Twitch secrets', async () => {
    const data = await api.getSecrets()
    state.twitch.configured = Boolean(data.twitch?.configured)
    renderTwitchConnection()
  })
}

// Shows what the plain "connected" label hides: a saved token Twitch no longer accepts, or a connection that is down
function renderTwitchHealth(isConnected) {
  const { health } = state.twitch
  let key = ''

  if (isConnected && health) {
    if (health.auth === 'reauthorize') key = 'settings.twitch.healthReauthorize'
    else if (isUnhealthy(health) && state.twitch.unhealthyPolls >= UNHEALTHY_POLLS_BEFORE_WARNING) key = 'settings.twitch.healthOffline'
  }

  setText(dom.twitchHealthWarning, key ? t(key) : '')
  show(dom.twitchHealthWarning, Boolean(key))
}

export function renderTwitchConnection() {
  const { configured, connected, user } = state.twitch

  show(dom.twitchNotConfigured, !configured)
  show(dom.twitchChannelField, configured)
  show(dom.twitchConnectionControls, configured)

  if (!configured) {
    for (const element of [dom.twitchAuthorization, dom.twitchRewardSection, dom.twitchRewardForm, dom.twitchHealthWarning, dom.twitchChatCommandsPanel]) {
      show(element, false)
    }
    return
  }

  const isConnected = Boolean(connected && user)
  renderTwitchHealth(isConnected)

  setText(dom.twitchChanelName, isConnected ? '@' + user.displayName : t('settings.twitch.notConnected'))
  setClass(dom.twitchChanelName, 'text-green', isConnected)
  setClass(dom.twitchChanelName, 'text-red', !isConnected)
  if (dom.twitchChanelImg) {
    const avatar = isConnected ? user.profileImageUrl : ''
    if (avatar) dom.twitchChanelImg.src = avatar
    else dom.twitchChanelImg.removeAttribute('src')
    show(dom.twitchChanelImg, Boolean(avatar))
  }

  show(dom.twitchConnectBtn, !isConnected)
  show(dom.twitchDisconnectBtn, isConnected)
  show(dom.twitchRewardSection, isConnected)
  show(dom.twitchRewardForm, isConnected)
  show(dom.twitchChatCommandsPanel, isConnected)
  if (!isConnected) show(dom.twitchRewardForm, false)
}
