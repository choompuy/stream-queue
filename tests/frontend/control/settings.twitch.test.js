import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

const PUBLIC_DIR = pathToFileURL(fileURLToPath(new URL('../../../public/', import.meta.url)))

const jsdom = new JSDOM(readFileSync(new URL('../../../public/index.html', import.meta.url), 'utf8').replace(/<script[^>]*><\/script>/g, ''))

globalThis.window = jsdom.window
globalThis.document = jsdom.window.document

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
const { state } = await import(new URL('js/control/state.js', PUBLIC_DIR))
const { dom } = await import(new URL('js/control/dom.js', PUBLIC_DIR))
// the five chat commands, and the id of their inputs: chatCmd<Name>Enabled / Command / Permission
const CHAT_COMMAND_FIELDS = ['now', 'queue', 'skip', 'pause', 'resume'].map((key) => ({ key, dom: `chatCmd${key[0].toUpperCase()}${key.slice(1)}` }))
const settings = await import(new URL('js/control/twitch/index.js', PUBLIC_DIR))
const { run } = await import(new URL('js/control/run.js', PUBLIC_DIR))
// the dispatcher of the panel runs every action like this: a failure is logged and shown
const connect = () => run('connecting Twitch', () => settings.connectTwitch())
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

  state.twitch.configured = true
  state.twitch.connected = false
  state.twitch.user = null
  state.twitch.connectedAt = null
  state.twitch.authorization = null
  state.twitch.rewards = []
  state.twitch.selectedRewardId = ''
  state.twitch.config = null

  dom.twitchRewardSelect.innerHTML = ''
  dom.twitchAutoFulfillRedemptions.checked = false
  dom.twitchRewardSelect.classList.remove('error')
  dom.twitchNotConfigured.classList.add('hidden')
  dom.twitchConnectionControls.classList.add('hidden')
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
test('connectTwitch', async (t) => {
  t.beforeEach(() => {
    reset()
    mock.timers.enable({ apis: ['setTimeout'] })
  })
  t.afterEach(() => mock.timers.reset())

  await t.test('shows the code and the page to enter it on, and then waits for the server instead of asking it', async () => {
    handlers = { 'POST /api/integrations/twitch/connect': () => deviceCode() }

    await drain(connect())

    assert.equal(state.twitch.authorization.userCode, 'ABCD-1234')

    mock.timers.tick(20 * 60 * 1000) // longer than the code lives
    await flush()

    assert.deepEqual(requests, ['POST /api/integrations/twitch/connect'], 'the page does not poll: the server says when the login ends')
  })

  await t.test('opens the authorization window before the API call and only then points it at Twitch', async () => {
    handlers = {
      'POST /api/integrations/twitch/connect': () => {
        // the popup has to exist by now: it is opened while the click is still being handled
        assert.equal(openedWindows.length, 1)
        assert.equal(openedWindows[0].url, '')
        return deviceCode()
      }
    }

    const pending = settings.connectTwitch()
    assert.equal(openedWindows.length, 1, 'window.open is called synchronously, not after the response')

    await drain(pending)

    assert.equal(openedWindows[0].href, 'https://twitch.tv/activate')
    assert.equal(openedWindows[0].opener, null)
  })

  await t.test('closes the popup and toasts when the device code response is incomplete', async () => {
    handlers = { 'POST /api/integrations/twitch/connect': () => ({ userCode: 'ABCD-1234' }) }

    await drain(connect())

    assert.equal(openedWindows[0].closed, true)
    assert.ok(document.getElementById('toastContainer').textContent.length > 0)
    assert.equal(state.twitch.authorization, null, 'a code that is not complete is not shown')
  })

  await t.test('closes the popup when the connect request itself fails', async () => {
    handlers = {
      'POST /api/integrations/twitch/connect': () => {
        throw new Error('server error')
      }
    }

    await drain(connect())

    assert.equal(openedWindows[0].closed, true, 'a failed connect must not leave a blank tab behind')
    assert.equal(dom.twitchConnectBtn.disabled, false)
  })

  await t.test('the connect button is usable again as soon as the code is shown (a new click replaces the code)', async () => {
    handlers = { 'POST /api/integrations/twitch/connect': () => deviceCode() }

    await drain(connect())

    assert.equal(dom.twitchConnectBtn.disabled, false)
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
    handlers = { 'POST /api/integrations/twitch/disconnect': () => null }

    await settings.disconnectTwitch()

    assert.equal(state.twitch.connected, false)
    assert.equal(state.twitch.user, null)
    assert.deepEqual(state.twitch.rewards, [])
    assert.ok(!dom.twitchConnectBtn.classList.contains('hidden'))
    assert.ok(dom.twitchRewardSelect.innerHTML.includes(translate('settings.twitch.noRewards')))
  })

  await t.test('takes away the code of a login that was still waiting', async () => {
    state.twitch.authorization = { userCode: 'ABCD-1234', verificationUri: 'https://twitch.tv/activate', expiresAt: Date.now() + 60_000 }
    handlers = { 'POST /api/integrations/twitch/disconnect': () => null }

    await settings.disconnectTwitch()

    assert.equal(state.twitch.authorization, null)
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

test('the selected reward is saved as the select shows it', async (t) => {
  t.beforeEach(reset)

  await t.test('sends the selected reward id (and nothing else) to the Twitch config endpoint', async () => {
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

  await t.test('sends the empty selection as it is: the server turns it into null', async () => {
    let sent = null
    handlers = {
      'PUT /api/integrations/twitch/config': () => {
        sent = JSON.parse(lastBody)
        return { config: { channelPointsRewardId: sent.channelPointsRewardId, chatCommands: CHAT_COMMANDS_CONFIG }, rejected: [] }
      }
    }

    // the stored selection is "reward-1": choosing "none" is a change
    dom.twitchRewardSelect.innerHTML = '<option value="">none</option><option value="reward-1" selected>One</option>'
    dom.twitchRewardSelect.value = ''

    await settings.saveTwitchConfig()

    assert.deepEqual(sent, { channelPointsRewardId: '' })
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
      'PUT /api/integrations/twitch/config': () => ({
        config: { channelPointsRewardId: null, chatCommands: CHAT_COMMANDS_CONFIG },
        rejected: ['channelPointsRewardId']
      })
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

  // what the panel was filled with: only what differs from it is sent
  const filledWithStoredCommands = async () => {
    handlers = { 'GET /api/integrations/twitch/config': () => ({ channelPointsRewardId: null, chatCommands: CHAT_COMMANDS_CONFIG }) }
    await settings.loadTwitchConfig()
  }

  const recordSave = () => {
    const box = { sent: null }
    handlers = {
      'PUT /api/integrations/twitch/config': () => {
        box.sent = JSON.parse(lastBody)
        return { config: { channelPointsRewardId: null, chatCommands: CHAT_COMMANDS_CONFIG }, rejected: [] }
      }
    }
    return box
  }

  await t.test('sends the commands and the cooldown that were changed, reading straight from the DOM', async () => {
    await filledWithStoredCommands()
    const save = recordSave()

    dom.chatCmdCooldown.value = '9'
    dom.chatCmdSkipEnabled.checked = !CHAT_COMMANDS_CONFIG.skip.enabled
    dom.chatCmdPauseCommand.value = '!sg hold'

    await settings.saveTwitchChatCommands()

    assert.deepEqual(save.sent, {
      chatCommands: {
        controlCooldownSeconds: 9,
        skip: { enabled: !CHAT_COMMANDS_CONFIG.skip.enabled },
        pause: { command: '!sg hold' }
      }
    })
  })

  await t.test('sends nothing of what stays as stored (another panel may have changed it)', async () => {
    await filledWithStoredCommands()
    const save = recordSave()

    await settings.saveTwitchChatCommands()

    assert.deepEqual(save.sent, {})
  })

  await t.test('trims whitespace from a command before sending it', async () => {
    await filledWithStoredCommands()
    const save = recordSave()

    dom.chatCmdSkipCommand.value = '  !sg next  '

    await settings.saveTwitchChatCommands()

    assert.equal(save.sent.chatCommands.skip.command, '!sg next')
  })

  await t.test('a command that only gained spaces is no change', async () => {
    await filledWithStoredCommands()
    const save = recordSave()

    dom.chatCmdSkipCommand.value = `  ${CHAT_COMMANDS_CONFIG.skip.command}  `

    await settings.saveTwitchChatCommands()

    assert.deepEqual(save.sent, {})
  })

  await t.test('marks only the toggles whose value really changed as saved', async () => {
    handlers = { 'GET /api/integrations/twitch/config': () => ({ channelPointsRewardId: null, chatCommands: CHAT_COMMANDS_CONFIG }) }
    await settings.loadTwitchConfig()

    const flipped = structuredClone(CHAT_COMMANDS_CONFIG)
    flipped.skip.enabled = !flipped.skip.enabled
    handlers = { 'PUT /api/integrations/twitch/config': () => ({ config: { channelPointsRewardId: null, chatCommands: flipped }, rejected: [] }) }
    dom.chatCmdSkipEnabled.checked = flipped.skip.enabled

    await settings.saveTwitchChatCommands()

    assert.ok(dom.chatCmdSkipEnabled.classList.contains('saved'))
    assert.equal(dom.chatCmdNowEnabled.classList.contains('saved'), false)
    assert.equal(dom.chatCmdSkipEnabled.checked, flipped.skip.enabled)
  })

  await t.test('a toggle is marked as changed while it differs from the stored value and cleared when it matches again', async () => {
    handlers = { 'GET /api/integrations/twitch/config': () => ({ channelPointsRewardId: null, chatCommands: CHAT_COMMANDS_CONFIG }) }
    await settings.loadTwitchConfig()
    settings.bindTwitchFieldTracking()

    const toggle = dom.chatCmdSkipEnabled
    // a real change event bubbles up to the form, where it is heard
    toggle.checked = !CHAT_COMMANDS_CONFIG.skip.enabled
    toggle.dispatchEvent(new jsdom.window.Event('change', { bubbles: true }))
    assert.ok(toggle.classList.contains('changed'))

    toggle.checked = CHAT_COMMANDS_CONFIG.skip.enabled
    toggle.dispatchEvent(new jsdom.window.Event('change', { bubbles: true }))
    assert.equal(toggle.classList.contains('changed'), false)
  })

  await t.test('cancelChatCommandChanges() puts the stored values back and clears the marks', async () => {
    handlers = { 'GET /api/integrations/twitch/config': () => ({ channelPointsRewardId: null, chatCommands: CHAT_COMMANDS_CONFIG }) }
    await settings.loadTwitchConfig()

    dom.chatCmdSkipEnabled.checked = !CHAT_COMMANDS_CONFIG.skip.enabled
    dom.chatCmdSkipCommand.value = '!typed'
    dom.chatCmdCooldown.value = '99'
    dom.chatCmdSkipCommand.classList.add('changed')
    dom.chatCmdSkipEnabled.classList.add('saved')

    settings.twitchActions['cancel-twitch-chat-commands']()

    assert.equal(dom.chatCmdSkipEnabled.checked, CHAT_COMMANDS_CONFIG.skip.enabled)
    assert.equal(dom.chatCmdSkipCommand.value, CHAT_COMMANDS_CONFIG.skip.command)
    assert.equal(dom.chatCmdCooldown.value, '7')
    assert.equal(dom.chatCmdSkipCommand.classList.contains('changed'), false)
    assert.equal(dom.chatCmdSkipEnabled.classList.contains('saved'), false)
  })

  await t.test('shows what the server stored, not what was typed (it lowercases and collapses spaces)', async () => {
    handlers = {
      'PUT /api/integrations/twitch/config': () => ({ config: { channelPointsRewardId: null, chatCommands: CHAT_COMMANDS_CONFIG }, rejected: [] })
    }
    dom.chatCmdSkipCommand.value = '  !SG   Skip '

    await settings.saveTwitchChatCommands()

    assert.equal(dom.chatCmdSkipCommand.value, '!sg skip')
  })

  await t.test('a refused command keeps what was typed, so it can be corrected', async () => {
    handlers = {
      'PUT /api/integrations/twitch/config': () => ({
        config: { chatCommands: CHAT_COMMANDS_CONFIG },
        rejected: ['chatCommands.skip.command']
      })
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
    assert.equal(toasts().includes('not saved 0'), false, 'nothing was refused, so there is no count of refused fields either')
  })
})

test('cancelConfigChanges()', async (t) => {
  t.beforeEach(reset)

  await t.test('drops what was typed into the API key field', () => {
    state.config = {}
    dom.secYoutubeKey.value = 'typed-but-not-saved'

    configSettings.cancelConfigChanges()

    assert.equal(dom.secYoutubeKey.value, '')
  })

  await t.test('does nothing before the config has been loaded', () => {
    state.config = null
    dom.secYoutubeKey.value = 'typed'

    configSettings.cancelConfigChanges()

    assert.equal(dom.secYoutubeKey.value, 'typed')
  })
})

test('disconnectTwitch(): redemptions left open', async (t) => {
  const { disconnectTwitch } = await import('../../../public/js/control/twitch/twitch-connection.js')

  const toasts = () => [...document.querySelectorAll('#toastContainer .toast')].map((toast) => toast.textContent)

  await t.test('a number above zero is shown to the streamer', async () => {
    document.getElementById('toastContainer').innerHTML = ''
    handlers = { 'POST /api/integrations/twitch/disconnect': () => ({ openRedemptions: 3 }) }

    await disconnectTwitch()

    assert.ok(
      toasts().some((text) => text.includes('3')),
      JSON.stringify(toasts())
    )
  })

  await t.test('nothing is shown when nothing was left open', async () => {
    document.getElementById('toastContainer').innerHTML = ''
    handlers = { 'POST /api/integrations/twitch/disconnect': () => ({ openRedemptions: 0 }) }

    await disconnectTwitch()

    assert.deepEqual(toasts(), [])
  })
})
