import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const jsdom = new JSDOM(
  `<!doctype html><html><body>
    <span id="twitchNotConfigured" class="hidden"></span>
    <div id="twitchChannelField">
      <img id="twitchChanelImg" class="hidden" />
      <span id="twitchChanelName"></span>
      <div id="twitchConnectionControls"></div>
    </div>
    <span id="twitchHealthWarning" class="hidden"></span>
    <button id="twitchConnectBtn"></button>
    <button id="twitchDisconnectBtn" class="hidden"></button>
    <div id="twitchAuthorization" class="hidden"></div>
    <div id="twitchRewardSection" class="hidden"></div>
    <div id="twitchRewardForm" class="hidden"></div>
    <div id="twitchChatCommandsPanel" class="hidden"></div>
    <div id="toastContainer"></div>
  </body></html>`
)

globalThis.window = jsdom.window
globalThis.document = jsdom.window.document

// what GET /api/integrations/twitch answers next
let status = null
globalThis.fetch = async (url) => {
  if (url.startsWith('/locales/')) return { ok: true, json: async () => ({}) }
  return { ok: true, json: async () => ({ data: status }) }
}

const { state } = await import('../../../public/js/control/state.js')
const { renderTwitchConnection, refreshTwitchHealth } = await import('../../../public/js/control/twitch/twitch-connection.js')

const el = (id) => document.getElementById(id)
const hidden = (id) => el(id).classList.contains('hidden')

const user = { displayName: 'Streamer', login: 'streamer', profileImageUrl: 'https://example.com/a.png' }
const up = { auth: 'ok', eventSub: true, chat: true }
const down = { auth: 'ok', eventSub: false, chat: false }

function connected(health, unhealthyPolls = 0) {
  Object.assign(state.twitch, { configured: true, connected: true, user, health, unhealthyPolls })
}

test('without a Client ID', async (t) => {
  await t.test('only the note is shown: no channel block, no avatar without a source, no warning', () => {
    Object.assign(state.twitch, { configured: false, connected: false, user: null, health: null })
    renderTwitchConnection()

    assert.equal(hidden('twitchNotConfigured'), false)
    assert.equal(hidden('twitchChannelField'), true)
    assert.equal(hidden('twitchChanelImg'), true)
    assert.equal(el('twitchChanelImg').hasAttribute('src'), false)
    assert.equal(hidden('twitchHealthWarning'), true)
  })
})

test('the avatar', async (t) => {
  await t.test('has a source only while connected', () => {
    connected(up)
    renderTwitchConnection()
    assert.equal(el('twitchChanelImg').getAttribute('src'), user.profileImageUrl)
    assert.equal(hidden('twitchChanelImg'), false)

    Object.assign(state.twitch, { connected: false, user: null })
    renderTwitchConnection()
    assert.equal(el('twitchChanelImg').hasAttribute('src'), false)
    assert.equal(hidden('twitchChanelImg'), true)
  })
})

test('the connection warning', async (t) => {
  await t.test('is not shown for a connection that has only just come down', () => {
    connected(down, 1)
    renderTwitchConnection()
    assert.equal(hidden('twitchHealthWarning'), true)
  })

  await t.test('is shown when it is still down at the next check', async () => {
    connected(down, 1)
    status = { connected: true, user, health: down }
    await refreshTwitchHealth()
    assert.equal(hidden('twitchHealthWarning'), false)
  })

  await t.test('goes away by itself once the connection is up, without reloading the page', async () => {
    status = { connected: true, user, health: up }
    await refreshTwitchHealth()
    assert.equal(hidden('twitchHealthWarning'), true)
    assert.equal(state.twitch.unhealthyPolls, 0)
  })

  await t.test('a refused login is shown at once', () => {
    connected({ auth: 'reauthorize', eventSub: false, chat: false }, 0)
    renderTwitchConnection()
    assert.equal(hidden('twitchHealthWarning'), false)
  })

  await t.test('an account disconnected elsewhere is shown as disconnected', async () => {
    connected(up)
    status = { connected: false, user: null, health: null }
    await refreshTwitchHealth()
    assert.equal(state.twitch.connected, false)
    assert.equal(hidden('twitchDisconnectBtn'), true)
  })

  await t.test('is not requested at all while the account is not connected', async () => {
    Object.assign(state.twitch, { configured: true, connected: false })
    status = null
    let requested = false
    const original = globalThis.fetch
    globalThis.fetch = async (...args) => {
      requested = true
      return original(...args)
    }
    await refreshTwitchHealth()
    globalThis.fetch = original
    assert.equal(requested, false)
  })
})
