import { show, setText, setClass } from '../../shared.js'
import { t } from '../../i18n.js'
import { api, ApiError } from '../api.js'
import { run } from '../run.js'
import { toastError, toastInfo } from '../toast.js'
import { state, isLocalDevice } from '../state.js'
import { dom } from '../dom.js'
import { log } from '../log.js'
import { loadTwitchRewards, renderTwitchRewards } from './twitch-rewards.js'

// A connection that is down for a moment (a reconnect takes seconds) is not worth a red warning: it is shown only if it stays down
const OFFLINE_WARNING_DELAY_MS = 6000

// the server drops the code a moment before or after its own deadline: a code that went away this close to it has expired
const EXPIRY_TOLERANCE_MS = 5000

let offlineTimer = null

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

// no status -> disconnected. The slice is assigned whole: the drawings (renderTwitchConnection) are called by hand
// where the flow needs them
function applyStatus(status) {
  const connected = Boolean(status?.connected)
  const health = connected ? status.health : null
  // a refused login ('reauthorize') is shown at once; a connection that is down only after it stayed down for a while
  const down = isUnhealthy(health) && health.auth !== 'reauthorize'

  clearTimeout(offlineTimer)
  offlineTimer = null
  let offlineWarning = false

  if (down) {
    if (state.twitch.offlineWarning) offlineWarning = true
    else {
      offlineTimer = setTimeout(() => {
        offlineTimer = null
        state.twitch = { ...state.twitch, offlineWarning: true }
        renderTwitchHealth(Boolean(state.twitch.connected && state.twitch.user))
      }, OFFLINE_WARNING_DELAY_MS)
    }
  }

  state.twitch = {
    ...state.twitch,
    connected,
    user: status?.user ?? null,
    connectedAt: status?.connectedAt ?? null,
    health,
    offlineWarning,
    // a login that waits for its code is only remembered while there is no account yet: the connect button is the way back to it
    authorization: connected ? null : (status?.authorization ?? null)
  }
}

// Reads the connection again and shows it as it is now. The account changes without this page doing it: a login finished in
// another tab, or in this one before it was reloaded (nobody here waits for it any more), or a disconnect done elsewhere.
// The server says when (the "twitch" event), this page does not ask in between
export function refreshTwitchStatus() {
  return run(
    'refreshing Twitch status',
    async () => {
      if (!state.twitch.configured) return
      if (!isLocalDevice()) return

      const wasConnected = Boolean(state.twitch.connected && state.twitch.user)
      const waitingFor = state.twitch.authorization
      const status = await api.getTwitchStatus()

      applyStatus(status)
      renderTwitchConnection()

      if (status.connected && !wasConnected) await loadTwitchRewards()

      // a code that went away without anybody entering it: it expired. A refused or replaced one is not worth a message
      if (waitingFor && !status.connected && !status.authorization && waitingFor.expiresAt <= Date.now() + EXPIRY_TOLERANCE_MS) {
        toastError(t('api.errors.twitchAuthExpired'))
      }
    },
    { silent: true }
  )
}

export async function connectTwitch() {
  const pending = state.twitch.authorization
  if (pending && pending.expiresAt > Date.now() + EXPIRY_TOLERANCE_MS) {
    window.open(pending.verificationUri, '_blank', 'noopener,noreferrer')
    return
  }

  // opened up-front so the popup is attributed to the click and not to the API response
  const authWindow = openAuthorizationWindow()

  let navigated = false

  try {
    const response = await api.connectTwitch()

    if (!response?.verificationUri || !response?.userCode) {
      throw new ApiError('Twitch authorization data is missing', { code: 'TWITCH_AUTH_ERROR' })
    }

    // From here the server keeps the state of the login (and says when it ends): this page does not wait for it, and
    // after a reload the same code is still there, with the button leading back to its page
    state.twitch.authorization = {
      userCode: response.userCode,
      verificationUri: response.verificationUri,
      expiresAt: Date.now() + response.expiresIn * 1000
    }
    renderTwitchConnection()

    navigateAuthorizationWindow(authWindow, response.verificationUri)
    navigated = true
  } finally {
    // the popup was opened before the request, so it is closed on every path that never sent it to Twitch
    if (!navigated) authWindow?.close()
  }
}

export async function disconnectTwitch() {
  const result = await api.disconnectTwitch()
  applyStatus(null)
  state.twitch = { ...state.twitch, rewards: [] }
  show(dom.twitchRewardForm, false)
  renderTwitchConnection()
  renderTwitchRewards()

  // queued tracks paid with points stay UNFULFILLED on Twitch: nobody else will close them
  const open = Number(result?.openRedemptions) || 0
  if (open > 0) toastInfo(t('toast.twitchDisconnectedWithOpenRewards', { count: open }))
}

// Shows what the plain "connected" label hides: a saved token Twitch no longer accepts, or a connection that is down
function renderTwitchHealth(isConnected) {
  const { health } = state.twitch
  let key = ''

  if (isConnected && health) {
    if (health.auth === 'reauthorize') key = 'settings.twitch.healthReauthorize'
    else if (state.twitch.offlineWarning) key = 'settings.twitch.healthOffline'
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
    for (const element of [dom.twitchRewardSection, dom.twitchRewardForm, dom.twitchHealthWarning, dom.twitchChatCommandsPanel]) {
      show(element, false)
    }
    return
  }

  const isConnected = Boolean(connected && user)
  renderTwitchHealth(isConnected)

  setText(dom.twitchChanelName, isConnected ? '@' + user.displayName : t('settings.twitch.notConnected'))
  setClass(dom.twitchChanelName, 'text-green', isConnected)
  setClass(dom.twitchChanelName, 'text-red', !isConnected)
  const avatar = isConnected ? user.profileImageUrl : ''
  if (avatar) dom.twitchChanelImg.src = avatar
  else dom.twitchChanelImg.removeAttribute('src')
  show(dom.twitchChanelImg, Boolean(avatar))

  show(dom.twitchConnectBtn, !isConnected)
  show(dom.twitchDisconnectBtn, isConnected)
  show(dom.twitchRewardSection, isConnected)
  show(dom.twitchRewardForm, isConnected)
  show(dom.twitchChatCommandsPanel, isConnected)
  if (!isConnected) show(dom.twitchRewardForm, false)
}
