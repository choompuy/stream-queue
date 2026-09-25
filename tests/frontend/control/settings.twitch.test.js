import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

const PUBLIC_DIR = pathToFileURL(fileURLToPath(new URL('../../../public/', import.meta.url)))

const jsdom = new JSDOM(
  `<!doctype html><html><body>
    <div id="twitchAuthorization" class="hidden"></div>
    <span id="twitchAuthorizationCode"></span>
    <div id="twitchConnectionStatus"></div>
    <button id="twitchConnectBtn"></button>
    <button id="twitchDisconnectBtn" class="hidden"></button>
    <div id="twitchRewardSection" class="hidden"></div>
    <select id="twitchRewardSelect"></select>
    <input id="secYoutubeKey" />
    <div id="secretsStatus"></div>
    <span id="queueCount"></span>
    <span id="tabQueueCount"></span>
    <div id="queueListWrapper"></div>
    <span id="playlistsCount"></span>
    <div id="playlistsListWrapper"></div>
    <div id="toastContainer"></div>
  </body></html>`
)

globalThis.window = jsdom.window
globalThis.document = jsdom.window.document

// requests the control panel makes, keyed by "METHOD path"
let handlers = {}
let requests = []
let openedWindows = []
let lastBody = null

globalThis.fetch = async (url, options = {}) => {
  const method = options.method ?? 'GET'
  requests.push(`${method} ${url}`)
  if (options.body) lastBody = options.body

  if (url.startsWith('/locales/')) {
    const locale = /\/locales\/(\w+)\.json/.exec(url)[1]
    return { ok: true, json: async () => JSON.parse(readFileSync(fileURLToPath(new URL(`locales/${locale}.json`, PUBLIC_DIR)), 'utf8')) }
  }

  const handler = handlers[`${method} ${url}`]
  assert.ok(handler, `unexpected request ${method} ${url}`)

  try {
    const data = await handler()
    return { ok: true, json: async () => ({ data }) }
  } catch (error) {
    return { ok: false, status: 500, json: async () => ({ error: error.message, code: 'SERVER_ERROR' }) }
  }
}

jsdom.window.open = (url) => {
  const opened = { url, href: null, closed: false, opener: {}, close() { this.closed = true } }
  Object.defineProperty(opened, 'location', {
    value: {
      set href(value) {
        opened.href = value
      }
    }
  })
  openedWindows.push(opened)
  return opened
}

const { t: translate, loadTranslations } = await import(new URL('js/i18n.js', PUBLIC_DIR))
const { state, dom } = await import(new URL('js/control/state.js', PUBLIC_DIR))
const settings = await import(new URL('js/control/settings.js', PUBLIC_DIR))

await loadTranslations('en')

const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve))
}

// Advances the mocked clock until the pending action settles (each tick releases one poll delay).
async function drain(promise, ticks = 10) {
  let settled = false
  const tracked = promise.then((value) => {
    settled = true
    return value
  })

  for (let i = 0; i < ticks && !settled; i++) {
    await flush()
    if (!settled) mock.timers.tick(2000)
  }

  await flush()
  return tracked
}

const REWARDS = [
  { id: 'reward-1', title: 'Song request', cost: 100 },
  { id: 'reward-2', title: 'Skip song', cost: 500 }
]

function reset() {
  handlers = {}
  requests = []
  openedWindows = []
  lastBody = null
  settings.stopTwitchPolling()

  state.config = null
  state.twitch.connected = false
  state.twitch.user = null
  state.twitch.connectedAt = null
  state.twitch.rewards = []
  state.twitch.selectedRewardId = ''

  dom.twitchRewardSelect.innerHTML = ''
  dom.twitchAuthorization.classList.add('hidden')
  dom.twitchConnectBtn.disabled = false
  document.getElementById('toastContainer').innerHTML = ''
}

const deviceCode = (expiresIn = 600) => ({ verificationUri: 'https://twitch.tv/activate', userCode: 'ABCD-1234', expiresIn })
const statusSequence = (...statuses) => {
  let index = 0
  return () => statuses[Math.min(index++, statuses.length - 1)]
}

test('connectTwitch', async (t) => {
  t.beforeEach(() => {
    reset()
    mock.timers.enable({ apis: ['setTimeout'] })
  })
  t.afterEach(() => mock.timers.reset())

  await t.test('polls until Twitch reports a connection and then loads the rewards', async () => {
    handlers = {
      'POST /api/integrations/twitch/connect': () => deviceCode(),
      'GET /api/integrations/twitch': statusSequence(
        { connected: false },
        { connected: true, user: { displayName: 'streamer' }, connectedAt: 1700000000000 }
      ),
      'GET /api/integrations/twitch/rewards': () => ({ rewards: REWARDS })
    }

    await drain(settings.connectTwitch())

    assert.equal(state.twitch.connected, true)
    assert.equal(state.twitch.user.displayName, 'streamer')
    assert.deepEqual(state.twitch.rewards, REWARDS)
    assert.equal(dom.twitchAuthorizationCode.textContent, 'ABCD-1234')
    assert.ok(dom.twitchAuthorization.classList.contains('hidden'))
    assert.ok(dom.twitchConnectBtn.classList.contains('hidden'))
    assert.ok(!dom.twitchDisconnectBtn.classList.contains('hidden'))
    assert.ok(dom.twitchRewardSelect.innerHTML.includes('Song request'))
  })

  await t.test('opens the authorization window before the API call and only then points it at Twitch', async () => {
    handlers = {
      'POST /api/integrations/twitch/connect': () => {
        // the popup has to exist by now: it is opened while the click is still being handled
        assert.equal(openedWindows.length, 1)
        assert.equal(openedWindows[0].url, '')
        return deviceCode()
      },
      'GET /api/integrations/twitch': () => ({ connected: true, user: { displayName: 'streamer' } }),
      'GET /api/integrations/twitch/rewards': () => ({ rewards: [] })
    }

    const pending = settings.connectTwitch()
    assert.equal(openedWindows.length, 1, 'window.open is called synchronously, not after the response')

    await drain(pending)

    assert.equal(openedWindows[0].href, 'https://twitch.tv/activate')
    assert.equal(openedWindows[0].opener, null)
  })

  await t.test('reports an expired authorization as an ApiError and hides the code', async () => {
    handlers = {
      'POST /api/integrations/twitch/connect': () => deviceCode(0),
      'GET /api/integrations/twitch': () => ({ connected: false })
    }

    await drain(settings.connectTwitch())

    assert.equal(state.twitch.connected, false)
    assert.ok(dom.twitchAuthorization.classList.contains('hidden'))
    const toast = document.getElementById('toastContainer').textContent
    assert.ok(toast.includes(translate('api.errors.twitchAuthExpired')), `expected an expiry toast, got "${toast}"`)
  })

  await t.test('closes the popup and toasts when the device code response is incomplete', async () => {
    handlers = { 'POST /api/integrations/twitch/connect': () => ({ userCode: 'ABCD-1234' }) }

    await drain(settings.connectTwitch())

    assert.equal(openedWindows[0].closed, true)
    assert.ok(document.getElementById('toastContainer').textContent.length > 0)
  })

  await t.test('closes the popup when the connect request itself fails', async () => {
    handlers = {
      'POST /api/integrations/twitch/connect': () => {
        throw new Error('server error')
      }
    }

    await drain(settings.connectTwitch())

    assert.equal(openedWindows[0].closed, true, 'a failed connect must not leave a blank tab behind')
    assert.equal(dom.twitchConnectBtn.disabled, false)
  })

  await t.test('disables the connect button for the whole polling window', async () => {
    let disabledWhilePolling = null

    handlers = {
      'POST /api/integrations/twitch/connect': () => deviceCode(),
      'GET /api/integrations/twitch': () => {
        disabledWhilePolling = dom.twitchConnectBtn.disabled
        return { connected: true, user: { displayName: 'streamer' } }
      },
      'GET /api/integrations/twitch/rewards': () => ({ rewards: [] })
    }

    await drain(settings.connectTwitch())

    assert.equal(disabledWhilePolling, true, 'a second click must not start a second poll loop')
    assert.equal(dom.twitchConnectBtn.disabled, false)
  })

  await t.test('a second connect attempt cancels the poll loop of the first one', async () => {
    handlers = {
      'POST /api/integrations/twitch/connect': () => deviceCode(),
      'GET /api/integrations/twitch': () => ({ connected: false })
    }

    const first = settings.connectTwitch()
    await flush()
    mock.timers.tick(2000)
    await flush()

    const pollsBefore = requests.filter((entry) => entry === 'GET /api/integrations/twitch').length
    settings.stopTwitchPolling()
    mock.timers.tick(2000)
    await flush()
    mock.timers.tick(2000)
    await flush()

    await first
    assert.equal(requests.filter((entry) => entry === 'GET /api/integrations/twitch').length, pollsBefore)
  })
})

test('disconnectTwitch', async (t) => {
  t.beforeEach(() => {
    reset()
    mock.timers.enable({ apis: ['setTimeout'] })
  })
  t.afterEach(() => mock.timers.reset())

  await t.test('clears the connection state, the rewards and the authorization code', async () => {
    state.twitch.connected = true
    state.twitch.user = { displayName: 'streamer' }
    state.twitch.rewards = REWARDS
    dom.twitchAuthorization.classList.remove('hidden')
    handlers = { 'POST /api/integrations/twitch/disconnect': () => null }

    await settings.disconnectTwitch()

    assert.equal(state.twitch.connected, false)
    assert.equal(state.twitch.user, null)
    assert.deepEqual(state.twitch.rewards, [])
    assert.ok(dom.twitchAuthorization.classList.contains('hidden'))
    assert.ok(!dom.twitchConnectBtn.classList.contains('hidden'))
    assert.ok(dom.twitchRewardSelect.innerHTML.includes(translate('settings.twitch.noRewards')))
  })

  await t.test('stops an in-flight poll loop', async () => {
    handlers = {
      'POST /api/integrations/twitch/connect': () => deviceCode(),
      'GET /api/integrations/twitch': () => ({ connected: false }),
      'POST /api/integrations/twitch/disconnect': () => null
    }

    const connecting = settings.connectTwitch()
    await flush()
    mock.timers.tick(2000)
    await flush()

    await settings.disconnectTwitch()
    const pollsAtDisconnect = requests.filter((entry) => entry === 'GET /api/integrations/twitch').length

    mock.timers.tick(2000)
    await flush()
    mock.timers.tick(2000)
    await flush()
    await connecting

    assert.equal(requests.filter((entry) => entry === 'GET /api/integrations/twitch').length, pollsAtDisconnect)
  })
})

test('loadTwitchSettings', async (t) => {
  t.beforeEach(reset)

  await t.test('does not ask for rewards while disconnected', async () => {
    handlers = { 'GET /api/integrations/twitch': () => ({ connected: false }) }

    await settings.loadTwitchSettings()

    assert.deepEqual(requests, ['GET /api/integrations/twitch'])
    assert.ok(dom.twitchRewardSection.classList.contains('hidden'))
  })

  await t.test('shows the "no rewards" option for an empty reward list', async () => {
    handlers = {
      'GET /api/integrations/twitch': () => ({ connected: true, user: { displayName: 'streamer' } }),
      'GET /api/integrations/twitch/rewards': () => ({ rewards: [] })
    }

    await settings.loadTwitchSettings()

    assert.equal(dom.twitchRewardSelect.textContent.trim(), translate('settings.twitch.noRewards'))
  })

  await t.test('keeps the configured reward selected when the config arrives after the rewards', async () => {
    handlers = {
      'GET /api/integrations/twitch': () => ({ connected: true, user: { displayName: 'streamer' } }),
      'GET /api/integrations/twitch/rewards': () => ({ rewards: REWARDS }),
      'GET /api/config': () => ({ twitch: { channelPointsRewardId: 'reward-2' } })
    }

    await settings.loadTwitchSettings()
    await settings.loadConfig()

    assert.equal(state.twitch.selectedRewardId, 'reward-2')
    assert.equal(dom.twitchRewardSelect.value, 'reward-2')
  })

  await t.test('keeps the configured reward selected when the config arrives before the rewards', async () => {
    handlers = {
      'GET /api/integrations/twitch': () => ({ connected: true, user: { displayName: 'streamer' } }),
      'GET /api/integrations/twitch/rewards': () => ({ rewards: REWARDS }),
      'GET /api/config': () => ({ twitch: { channelPointsRewardId: 'reward-2' } })
    }

    await settings.loadConfig()
    // the <select> is still empty here - the id has to survive in state until the options exist
    assert.equal(dom.twitchRewardSelect.value, '')

    await settings.loadTwitchSettings()

    assert.equal(dom.twitchRewardSelect.value, 'reward-2')
  })

  await t.test('a reward that disappeared from Twitch does not wipe the configured id', async () => {
    handlers = {
      'GET /api/integrations/twitch': () => ({ connected: true, user: { displayName: 'streamer' } }),
      'GET /api/integrations/twitch/rewards': () => ({ rewards: [] }),
      'GET /api/config': () => ({ twitch: { channelPointsRewardId: 'reward-gone' } })
    }

    await settings.loadConfig()
    await settings.loadTwitchSettings()

    assert.equal(state.twitch.selectedRewardId, 'reward-gone')
  })
})

test('the reward id is saved from state, not from the select element', async (t) => {
  t.beforeEach(reset)

  await t.test('sends the selected reward id with the config update', async () => {
    let sent = null
    handlers = {
      'GET /api/integrations/twitch': () => ({ connected: true, user: { displayName: 'streamer' } }),
      'GET /api/integrations/twitch/rewards': () => ({ rewards: REWARDS }),
      'PUT /api/config': () => {
        sent = JSON.parse(lastBody)
        return sent
      }
    }

    await settings.loadTwitchSettings()
    dom.twitchRewardSelect.value = 'reward-1'
    settings.onTwitchRewardChange()
    await settings.saveTwitchConfig()

    assert.equal(sent.twitch.channelPointsRewardId, 'reward-1')
  })

  await t.test('sends null when no reward is selected', async () => {
    let sent = null
    handlers = {
      'PUT /api/config': () => {
        sent = JSON.parse(lastBody)
        return sent
      }
    }

    await settings.saveTwitchConfig()

    assert.equal(sent.twitch.channelPointsRewardId, null)
  })
})
