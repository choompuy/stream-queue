import { show, setText, setClass } from '../../shared.js'
import { t } from '../../i18n.js'
import { api, ApiError } from '../api.js'
import { run } from '../run.js'
import { toastError, toastInfo } from '../toast.js'
import { state, on, patch, isLocalDevice } from '../state.js'
import { dom } from '../dom.js'
import { log } from '../log.js'
import { loadTwitchRewards } from './twitch-rewards.js'

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

// Reads the connection again and shows it as it is now. The account changes without this page doing it: a login finished in
// another tab, or in this one before it was reloaded (nobody here waits for it any more), or a disconnect done elsewhere.
// The server says when (the "twitch" event), this page does not ask in between
export function readTwitchStatus() {
  return run(
    'refreshing Twitch status',
    async () => {
      if (!state.twitch.configured) return
      if (!isLocalDevice()) return

      const wasConnected = Boolean(state.twitch.connected && state.twitch.user)
      const waitingFor = state.twitch.authorization
      const status = await api.getTwitchStatus()

      patch('twitch', {
        connected: Boolean(status?.connected),
        user: status?.user ?? null,
        connectedAt: status?.connectedAt ?? null,
        // a login that waits for its code is only remembered while there is no account yet: the connect button is the way back to it
        authorization: status?.connected ? null : (status?.authorization ?? null)
      })

      if (status?.connected && !wasConnected) await loadTwitchRewards()

      // how the login ended is the server's to say: an expired code was waiting for its entry a moment ago
      if (waitingFor?.state === 'pending' && !status?.connected && status?.authorization?.state === 'expired') {
        toastError(t('api.errors.twitchAuthExpired'))
      }
    },
    { silent: true }
  )
}

export async function connectTwitch() {
  const pending = state.twitch.authorization
  if (pending?.state === 'pending' && pending.expiresAt > Date.now()) {
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
    // after a reload the same code is still there, with the button leading back to its page. The deadline is the
    // server's own, not counted from the moment this answer arrived
    patch('twitch', {
      authorization: {
        state: 'pending',
        userCode: response.userCode,
        verificationUri: response.verificationUri,
        expiresAt: response.expiresAt
      }
    })

    navigateAuthorizationWindow(authWindow, response.verificationUri)
    navigated = true
  } finally {
    // the popup was opened before the request, so it is closed on every path that never sent it to Twitch
    if (!navigated) authWindow?.close()
  }
}

export async function disconnectTwitch() {
  const result = await api.disconnectTwitch()
  patch('twitch', { connected: false, user: null, connectedAt: null, authorization: null, rewards: [] })

  // queued tracks paid with points stay UNFULFILLED on Twitch: nobody else will close them
  const open = Number(result?.openRedemptions) || 0
  if (open > 0) toastInfo(t('toast.twitchDisconnectedWithOpenRewards', { count: open }))
}

export function renderTwitchConnection() {
  const { configured, connected, user } = state.twitch

  show(dom.twitchNotConfigured, !configured)
  show(dom.twitchChannelField, configured)
  show(dom.twitchConnectionControls, configured)

  if (!configured) {
    for (const element of [dom.twitchRewardSection, dom.twitchRewardForm, dom.twitchChatCommandsPanel]) {
      show(element, false)
    }
    return
  }

  const isConnected = Boolean(connected && user)

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

// the connection block follows the twitch slice: whoever changes a part of it patches the slice, and this drawing runs
on('twitch', renderTwitchConnection)
