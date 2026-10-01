import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

const PUBLIC_DIR = pathToFileURL(fileURLToPath(new URL('../../../public/', import.meta.url)))

const jsdom = new JSDOM(
  `<!doctype html><html><body>
    <div id="twitchNotConfigured" class="hidden"></div>
    <div id="twitchConnectionControls" class="hidden"></div>
    <div id="twitchAuthorization" class="hidden"></div>
    <span id="twitchAuthorizationCode"></span>
    <button id="twitchConnectBtn"></button>
    <button id="twitchDisconnectBtn" class="hidden"></button>
    <div id="twitchRewardSection" class="hidden"></div>
    <select id="twitchRewardSelect"></select>
    <div id="twitchChatCommandsPanel" class="hidden"></div>
    <input type="checkbox" id="chatCmdNowEnabled" />
    <input id="chatCmdNowCommand" />
    <select id="chatCmdNowPermission"><option value="everyone"></option><option value="moderator"></option><option value="broadcaster"></option></select>
    <input type="checkbox" id="chatCmdQueueEnabled" />
    <input id="chatCmdQueueCommand" />
    <select id="chatCmdQueuePermission"><option value="everyone"></option><option value="moderator"></option><option value="broadcaster"></option></select>
    <input type="checkbox" id="chatCmdSkipEnabled" />
    <input id="chatCmdSkipCommand" />
    <select id="chatCmdSkipPermission"><option value="everyone"></option><option value="moderator"></option><option value="broadcaster"></option></select>
    <input type="checkbox" id="chatCmdPauseEnabled" />
    <input id="chatCmdPauseCommand" />
    <select id="chatCmdPausePermission"><option value="everyone"></option><option value="moderator"></option><option value="broadcaster"></option></select>
    <input type="checkbox" id="chatCmdResumeEnabled" />
    <input id="chatCmdResumeCommand" />
    <select id="chatCmdResumePermission"><option value="everyone"></option><option value="moderator"></option><option value="broadcaster"></option></select>
    <input id="chatCmdCooldown" />
    <input id="chatCmdPlainCooldown" />
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

// disconnectTwitch() asks for confirmation; a test flips this to simulate the user cancelling
let confirmAnswer = true
globalThis.confirm = () => confirmAnswer

// requests the control panel makes, keyed by "METHOD path"
let handlers = {}
let requests = []
let openedWindows = []
let lastBody = null

// a handler throws this to simulate a specific API error response (code/params), instead of the
// generic SERVER_ERROR fallback below
class MockApiFailure extends Error {
  constructor(message, code, params, data = null) {
    super(`mock API failure: ${code}`)
    this.message = message
    this.code = code
    this.params = params
    this.data = data
  }
}

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
    if (error instanceof MockApiFailure) {
      const body = { error: error.message, code: error.code, params: error.params }
      if (error.data) body.data = error.data
      return { ok: false, status: 400, json: async () => body }
    }
    return { ok: false, status: 500, json: async () => ({ error: error.message, code: 'SERVER_ERROR' }) }
  }
}

jsdom.window.open = (url) => {
  const opened = {
    url,
    href: null,
    closed: false,
    opener: {},
    close() {
      this.closed = true
    }
  }
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
const { state, dom, CHAT_COMMAND_FIELDS } = await import(new URL('js/control/state.js', PUBLIC_DIR))
const settings = await import(new URL('js/control/twitch/index.js', PUBLIC_DIR))
const configSettings = await import(new URL('js/control/settings.js', PUBLIC_DIR))

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
  confirmAnswer = true
  settings.stopTwitchPolling()

  state.twitch.configured = true
  state.twitch.connected = false
  state.twitch.user = null
  state.twitch.connectedAt = null
  state.twitch.rewards = []
  state.twitch.selectedRewardId = ''

  dom.twitchRewardSelect.innerHTML = ''
  dom.twitchRewardSelect.classList.remove('error')
  dom.twitchNotConfigured.classList.add('hidden')
  dom.twitchConnectionControls.classList.add('hidden')
  dom.twitchAuthorization.classList.add('hidden')
  dom.twitchConnectBtn.disabled = false
  dom.twitchConnectBtn.classList.remove('hidden')
  dom.twitchDisconnectBtn.classList.add('hidden')
  dom.twitchRewardSection.classList.add('hidden')
  dom.twitchChatCommandsPanel.classList.add('hidden')

  for (const field of CHAT_COMMAND_FIELDS) {
    dom[`${field.dom}Enabled`].checked = false
    dom[`${field.dom}Command`].value = ''
    dom[`${field.dom}Command`].classList.remove('error')
    dom[`${field.dom}Permission`].selectedIndex = 0
  }
  dom.chatCmdCooldown.value = ''
  dom.chatCmdCooldown.classList.remove('error')
  dom.chatCmdPlainCooldown.value = ''
  dom.chatCmdPlainCooldown.classList.remove('error')

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

  await t.test('does not even ask Twitch for its status while the client id is not configured', async () => {
    state.twitch.configured = false

    await settings.loadTwitchSettings()

    assert.deepEqual(requests, [])
    assert.ok(!dom.twitchNotConfigured.classList.contains('hidden'), 'the "not configured" notice is shown')
    assert.ok(dom.twitchConnectionControls.classList.contains('hidden'), 'the connect controls are hidden')
  })

  await t.test('shows the connected UI, including the chat commands panel, once Twitch is connected', async () => {
    handlers = {
      'GET /api/integrations/twitch': () => ({ connected: true, user: { displayName: 'streamer' } }),
      'GET /api/integrations/twitch/rewards': () => ({ rewards: [] })
    }

    await settings.loadTwitchSettings()

    assert.ok(!dom.twitchConnectionControls.classList.contains('hidden'))
    assert.ok(!dom.twitchRewardSection.classList.contains('hidden'))
    assert.ok(!dom.twitchChatCommandsPanel.classList.contains('hidden'))
    assert.ok(dom.twitchConnectBtn.classList.contains('hidden'))
    assert.ok(!dom.twitchDisconnectBtn.classList.contains('hidden'))
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
      'GET /api/integrations/twitch/config': () => ({ channelPointsRewardId: 'reward-2' })
    }

    await settings.loadTwitchSettings()
    await settings.loadTwitchConfig()

    assert.equal(state.twitch.selectedRewardId, 'reward-2')
    assert.equal(dom.twitchRewardSelect.value, 'reward-2')
  })

  await t.test('keeps the configured reward selected when the config arrives before the rewards', async () => {
    handlers = {
      'GET /api/integrations/twitch': () => ({ connected: true, user: { displayName: 'streamer' } }),
      'GET /api/integrations/twitch/rewards': () => ({ rewards: REWARDS }),
      'GET /api/integrations/twitch/config': () => ({ channelPointsRewardId: 'reward-2' })
    }

    await settings.loadTwitchConfig()
    // the <select> is still empty here - the id has to survive in state until the options exist
    assert.equal(dom.twitchRewardSelect.value, '')

    await settings.loadTwitchSettings()

    assert.equal(dom.twitchRewardSelect.value, 'reward-2')
  })

  await t.test('a reward that disappeared from Twitch does not wipe the configured id', async () => {
    handlers = {
      'GET /api/integrations/twitch': () => ({ connected: true, user: { displayName: 'streamer' } }),
      'GET /api/integrations/twitch/rewards': () => ({ rewards: [] }),
      'GET /api/integrations/twitch/config': () => ({ channelPointsRewardId: 'reward-gone' })
    }

    await settings.loadTwitchConfig()
    await settings.loadTwitchSettings()

    assert.equal(state.twitch.selectedRewardId, 'reward-gone')
  })
})

test('disconnectTwitch asks for confirmation first', async (t) => {
  t.beforeEach(reset)

  await t.test('cancelling the confirmation changes nothing and sends no request', async () => {
    state.twitch.connected = true
    state.twitch.user = { displayName: 'streamer' }
    confirmAnswer = false

    await settings.disconnectTwitch()

    assert.equal(state.twitch.connected, true)
    assert.deepEqual(requests, [])
  })
})

test('loadTwitchSecrets', async (t) => {
  t.beforeEach(reset)

  await t.test('remembers that a client id is configured', async () => {
    state.twitch.configured = false
    handlers = { 'GET /api/secrets': () => ({ twitch: { configured: true } }) }

    await settings.loadTwitchSecrets()

    assert.equal(state.twitch.configured, true)
  })

  await t.test('hides the connect controls and shows the notice when no client id is configured', async () => {
    handlers = { 'GET /api/secrets': () => ({ twitch: { configured: false } }) }

    await settings.loadTwitchSecrets()

    assert.equal(state.twitch.configured, false)
    assert.ok(!dom.twitchNotConfigured.classList.contains('hidden'))
    assert.ok(dom.twitchConnectionControls.classList.contains('hidden'))
  })
})

const CHAT_COMMANDS_CONFIG = {
  now: { enabled: true, command: '!sg now', permission: 'everyone' },
  queue: { enabled: true, command: '!sg queue', permission: 'everyone' },
  skip: { enabled: true, command: '!sg skip', permission: 'moderator' },
  pause: { enabled: false, command: '!sg pause', permission: 'moderator' },
  resume: { enabled: true, command: '!sg resume', permission: 'broadcaster' },
  controlCooldownSeconds: 7,
  plainCooldownSeconds: 3
}

test('the reward id is saved from state, not from the select element', async (t) => {
  t.beforeEach(reset)

  await t.test('sends the selected reward id to the Twitch config endpoint', async () => {
    let sent = null
    handlers = {
      'GET /api/integrations/twitch': () => ({ connected: true, user: { displayName: 'streamer' } }),
      'GET /api/integrations/twitch/rewards': () => ({ rewards: REWARDS }),
      'PUT /api/integrations/twitch/config': () => {
        sent = JSON.parse(lastBody)
        return { config: { channelPointsRewardId: sent.channelPointsRewardId, chatCommands: CHAT_COMMANDS_CONFIG }, rejected: [] }
      }
    }

    await settings.loadTwitchSettings()
    dom.twitchRewardSelect.value = 'reward-1'
    settings.onTwitchRewardChange()
    await settings.saveTwitchConfig()

    assert.deepEqual(sent, { channelPointsRewardId: 'reward-1' })
  })

  await t.test('sends null when no reward is selected', async () => {
    let sent = null
    handlers = {
      'PUT /api/integrations/twitch/config': () => {
        sent = JSON.parse(lastBody)
        return { config: { channelPointsRewardId: sent.channelPointsRewardId, chatCommands: CHAT_COMMANDS_CONFIG }, rejected: [] }
      }
    }

    await settings.saveTwitchConfig()

    assert.deepEqual(sent, { channelPointsRewardId: null })
  })

  await t.test('shows a success toast on success', async () => {
    handlers = {
      'PUT /api/integrations/twitch/config': () => ({ config: { channelPointsRewardId: null, chatCommands: CHAT_COMMANDS_CONFIG }, rejected: [] })
    }

    await settings.saveTwitchConfig()

    assert.ok(document.getElementById('toastContainer').textContent.includes(translate('toast.twitchSettingsSaved')))
  })
})

test('saveTwitchConfig() highlights the reward select when the backend rejects it', async (t) => {
  t.beforeEach(reset)

  await t.test('a rejected channelPointsRewardId puts the error class on the select and toasts', async () => {
    handlers = {
      'PUT /api/integrations/twitch/config': () => {
        throw new MockApiFailure(
          'invalid config fields',
          'INVALID_CONFIG',
          { fields: 'channelPointsRewardId' },
          {
            config: { channelPointsRewardId: null, chatCommands: CHAT_COMMANDS_CONFIG },
            rejected: ['channelPointsRewardId']
          }
        )
      }
    }

    await settings.saveTwitchConfig()

    assert.ok(dom.twitchRewardSelect.classList.contains('error'))
    assert.ok(document.getElementById('toastContainer').textContent.includes(translate('toast.settingsPartiallySaved', { saved: 0, rejected: 1 })))
  })

  await t.test('a rejection for an unrelated field does not touch the reward select', async () => {
    handlers = {
      'PUT /api/integrations/twitch/config': () => ({
        config: { channelPointsRewardId: null, chatCommands: CHAT_COMMANDS_CONFIG },
        rejected: ['chatCommands.skip.command']
      })
    }

    await settings.saveTwitchConfig()

    assert.equal(dom.twitchRewardSelect.classList.contains('error'), false)
  })

  await t.test('clears a previous error class when the next save goes through', async () => {
    dom.twitchRewardSelect.classList.add('error')
    handlers = {
      'PUT /api/integrations/twitch/config': () => ({ config: { channelPointsRewardId: null, chatCommands: CHAT_COMMANDS_CONFIG }, rejected: [] })
    }

    await settings.saveTwitchConfig()

    assert.equal(dom.twitchRewardSelect.classList.contains('error'), false)
  })
})

test('loadTwitchConfig() fills in the chat command fields', async (t) => {
  t.beforeEach(reset)

  await t.test('populates enabled/command/permission for every command and the cooldown', async () => {
    handlers = { 'GET /api/integrations/twitch/config': () => ({ channelPointsRewardId: null, chatCommands: CHAT_COMMANDS_CONFIG }) }

    await settings.loadTwitchConfig()

    for (const field of CHAT_COMMAND_FIELDS) {
      const expected = CHAT_COMMANDS_CONFIG[field.key]
      assert.equal(dom[`${field.dom}Enabled`].checked, expected.enabled, `${field.key}.enabled`)
      assert.equal(dom[`${field.dom}Command`].value, expected.command, `${field.key}.command`)
      assert.equal(dom[`${field.dom}Permission`].value, expected.permission, `${field.key}.permission`)
    }
    assert.equal(dom.chatCmdCooldown.value, '7')
    assert.equal(dom.chatCmdPlainCooldown.value, '3')
  })

  await t.test('does nothing and does not throw when the config has no chatCommands yet', async () => {
    handlers = { 'GET /api/integrations/twitch/config': () => ({ channelPointsRewardId: null }) }

    await assert.doesNotReject(() => settings.loadTwitchConfig())
  })
})

test('saveTwitchChatCommands()', async (t) => {
  t.beforeEach(reset)

  await t.test('sends every command and the cooldown, reading straight from the DOM', async () => {
    let sent = null
    handlers = {
      'PUT /api/integrations/twitch/config': () => {
        sent = JSON.parse(lastBody)
        return { config: { channelPointsRewardId: null, chatCommands: CHAT_COMMANDS_CONFIG }, rejected: [] }
      }
    }

    for (const field of CHAT_COMMAND_FIELDS) {
      const expected = CHAT_COMMANDS_CONFIG[field.key]
      dom[`${field.dom}Enabled`].checked = expected.enabled
      dom[`${field.dom}Command`].value = expected.command
      dom[`${field.dom}Permission`].value = expected.permission
    }
    dom.chatCmdCooldown.value = '7'
    dom.chatCmdPlainCooldown.value = '3'

    await settings.saveTwitchChatCommands()

    assert.deepEqual(sent, { chatCommands: CHAT_COMMANDS_CONFIG })
  })

  await t.test('trims whitespace from a command before sending it', async () => {
    let sent = null
    handlers = {
      'PUT /api/integrations/twitch/config': () => {
        sent = JSON.parse(lastBody)
        return { config: { channelPointsRewardId: null, chatCommands: CHAT_COMMANDS_CONFIG }, rejected: [] }
      }
    }

    dom.chatCmdSkipCommand.value = '  !sg skip  '

    await settings.saveTwitchChatCommands()

    assert.equal(sent.chatCommands.skip.command, '!sg skip')
  })

  await t.test('shows what the server stored, not what was typed (it lowercases and collapses spaces)', async () => {
    handlers = { 'PUT /api/integrations/twitch/config': () => ({ config: { channelPointsRewardId: null, chatCommands: CHAT_COMMANDS_CONFIG }, rejected: [] }) }
    dom.chatCmdSkipCommand.value = '  !SG   Skip '

    await settings.saveTwitchChatCommands()

    assert.equal(dom.chatCmdSkipCommand.value, '!sg skip')
  })

  await t.test('a refused command keeps what was typed, so it can be corrected', async () => {
    handlers = {
      'PUT /api/integrations/twitch/config': () => {
        throw new MockApiFailure('invalid config fields', 'INVALID_CONFIG', { fields: 'chatCommands.skip.command' }, {
          config: { chatCommands: CHAT_COMMANDS_CONFIG },
          rejected: ['chatCommands.skip.command']
        })
      }
    }
    dom.chatCmdSkipCommand.value = 'no-bang'

    await settings.saveTwitchChatCommands()

    assert.equal(dom.chatCmdSkipCommand.value, 'no-bang')
    assert.ok(dom.chatCmdSkipCommand.classList.contains('error'))
  })

  await t.test('shows a success toast on success', async () => {
    handlers = { 'PUT /api/integrations/twitch/config': () => ({ config: { chatCommands: CHAT_COMMANDS_CONFIG }, rejected: [] }) }

    await settings.saveTwitchChatCommands()

    assert.ok(document.getElementById('toastContainer').textContent.includes(translate('toast.twitchChatCommandsSaved')))
  })

  await t.test('highlights the rejected command field and toasts', async () => {
    handlers = {
      'PUT /api/integrations/twitch/config': () => ({
        config: { chatCommands: CHAT_COMMANDS_CONFIG },
        rejected: ['chatCommands.skip.command']
      })
    }

    await settings.saveTwitchChatCommands()

    assert.ok(dom.chatCmdSkipCommand.classList.contains('error'))
    assert.equal(dom.chatCmdNowCommand.classList.contains('error'), false)
    assert.ok(document.getElementById('toastContainer').textContent.length > 0)
  })

  await t.test('highlights the cooldown field when it is rejected', async () => {
    handlers = {
      'PUT /api/integrations/twitch/config': () => ({
        config: { chatCommands: CHAT_COMMANDS_CONFIG },
        rejected: ['chatCommands.controlCooldownSeconds']
      })
    }

    await settings.saveTwitchChatCommands()

    assert.ok(dom.chatCmdCooldown.classList.contains('error'))
  })

  await t.test('clears a previous error class when the next save goes through', async () => {
    dom.chatCmdSkipCommand.classList.add('error')
    dom.chatCmdCooldown.classList.add('error')
    handlers = { 'PUT /api/integrations/twitch/config': () => ({ config: { chatCommands: CHAT_COMMANDS_CONFIG }, rejected: [] }) }

    await settings.saveTwitchChatCommands()

    assert.equal(dom.chatCmdSkipCommand.classList.contains('error'), false)
    assert.equal(dom.chatCmdCooldown.classList.contains('error'), false)
  })
})

test('saveConfigSetting() and the YouTube API key', async (t) => {
  t.beforeEach(reset)

  const toasts = () => document.getElementById('toastContainer').textContent

  await t.test('a key that saves fine ends with "Settings saved"', async () => {
    handlers = {
      'PUT /api/config': () => ({ config: {}, rejected: [] }),
      'PUT /api/secrets': () => ({}),
      'GET /api/secrets': () => ({ twitch: { configured: true }, hasYoutubeApiKey: true })
    }
    dom.secYoutubeKey.value = 'some-key'

    await configSettings.saveConfigSetting()

    assert.ok(toasts().includes(translate('toast.settingsSaved')))
  })

  await t.test('a key that fails to save shows only "API key was not saved" - no green "Settings saved" after it', async () => {
    handlers = {
      'PUT /api/config': () => ({ config: {}, rejected: [] }),
      'PUT /api/secrets': () => {
        throw new MockApiFailure('nope', 'SERVER_ERROR', undefined)
      }
    }
    dom.secYoutubeKey.value = 'some-key'

    await configSettings.saveConfigSetting()

    assert.ok(toasts().includes(translate('toast.apiKeyNotSaved')))
    assert.equal(toasts().includes(translate('toast.settingsSaved')), false)
  })
})
