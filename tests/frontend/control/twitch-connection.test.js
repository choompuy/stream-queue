import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const jsdom = new JSDOM(readFileSync(new URL('../../../public/index.html', import.meta.url), 'utf8').replace(/<script[^>]*><\/script>/g, ''))

globalThis.window = jsdom.window
globalThis.document = jsdom.window.document

// what GET /api/integrations/twitch answers next
let status = null
globalThis.fetch = async (url) => {
  if (url.startsWith('/locales/')) return { ok: true, json: async () => ({}) }
  return { ok: true, json: async () => ({ data: status }) }
}

const { state } = await import('../../../public/js/control/state.js')
const { renderTwitchConnection, refreshTwitchStatus } = await import('../../../public/js/control/twitch/twitch-connection.js')

const el = (id) => document.getElementById(id)
const hidden = (id) => el(id).classList.contains('hidden')

const user = { displayName: 'Streamer', login: 'streamer', profileImageUrl: 'https://example.com/a.png' }
const up = { auth: 'ok', eventSub: true, chat: true }
const down = { auth: 'ok', eventSub: false, chat: false }

function connected(health, offlineWarning = false) {
  Object.assign(state.twitch, { configured: true, connected: true, user, health, offlineWarning })
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
  await t.test('is not shown for a connection that has only just come down', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    connected(up)
    status = { connected: true, user, health: down }

    await refreshTwitchStatus()
    t.mock.timers.tick(5999)

    assert.equal(hidden('twitchHealthWarning'), true)

    // the timer belongs to this test's clock: a healthy answer takes it back, so that the next test starts clean
    status = { connected: true, user, health: up }
    await refreshTwitchStatus()
  })

  await t.test('is shown when it stays down for 6 seconds', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    connected(up)
    status = { connected: true, user, health: down }

    await refreshTwitchStatus()
    t.mock.timers.tick(6000)

    assert.equal(hidden('twitchHealthWarning'), false)
  })

  await t.test('a connection that comes back in time never shows it', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    connected(up)
    status = { connected: true, user, health: down }
    await refreshTwitchStatus()
    t.mock.timers.tick(3000)

    status = { connected: true, user, health: up }
    await refreshTwitchStatus()
    t.mock.timers.tick(10000)

    assert.equal(hidden('twitchHealthWarning'), true)
    assert.equal(state.twitch.offlineWarning, false)
  })

  await t.test('goes away by itself once the connection is up, without reloading the page', async () => {
    connected(down, true)
    renderTwitchConnection()
    assert.equal(hidden('twitchHealthWarning'), false)

    status = { connected: true, user, health: up }
    await refreshTwitchStatus()
    assert.equal(hidden('twitchHealthWarning'), true)
    assert.equal(state.twitch.offlineWarning, false)
  })

  await t.test('a refused login is shown at once', () => {
    connected({ auth: 'reauthorize', eventSub: false, chat: false })
    renderTwitchConnection()
    assert.equal(hidden('twitchHealthWarning'), false)
  })

  await t.test('an account disconnected elsewhere is shown as disconnected', async () => {
    connected(up)
    status = { connected: false, user: null, health: null }
    await refreshTwitchStatus()
    assert.equal(state.twitch.connected, false)
    assert.equal(hidden('twitchDisconnectBtn'), true)
  })
})

test('a connection made elsewhere', async (t) => {
  await t.test('shows up on the next refresh, also on a page that was reloaded in the middle of the login', async () => {
    // the panel was loaded while nobody was logged in; the login is finished later, in another tab
    Object.assign(state.twitch, { configured: true, connected: false, user: null, health: null, offlineWarning: false })
    renderTwitchConnection()
    assert.equal(hidden('twitchDisconnectBtn'), true)

    status = { connected: true, user, health: up, connectedAt: 1700000000000 }
    await refreshTwitchStatus()

    assert.equal(state.twitch.connected, true)
    assert.equal(state.twitch.user.displayName, 'Streamer')
    assert.equal(el('twitchChanelName').textContent, '@Streamer')
    assert.equal(hidden('twitchDisconnectBtn'), false)
    assert.equal(hidden('twitchConnectBtn'), true)
    assert.equal(hidden('twitchRewardSection'), false)
  })

  await t.test('the rewards are loaded once, when the account turns up, and not on every refresh', async () => {
    Object.assign(state.twitch, { configured: true, connected: false, user: null, health: null })
    status = { connected: true, user, health: up }
    let rewardRequests = 0
    const original = globalThis.fetch
    globalThis.fetch = async (url, ...rest) => {
      if (String(url).includes('/rewards')) rewardRequests++
      return original(url, ...rest)
    }

    try {
      await refreshTwitchStatus()
      await refreshTwitchStatus()
    } finally {
      globalThis.fetch = original
    }

    assert.equal(rewardRequests, 1)
  })

  await t.test('an account that is not connected is still asked about, so that a later login is seen', async () => {
    Object.assign(state.twitch, { configured: true, connected: false, user: null })
    status = { connected: false, user: null, health: null }
    let requested = false
    const original = globalThis.fetch
    globalThis.fetch = async (...args) => {
      requested = true
      return original(...args)
    }

    try {
      await refreshTwitchStatus()
    } finally {
      globalThis.fetch = original
    }

    assert.equal(requested, true)
    assert.equal(state.twitch.connected, false)
    assert.equal(hidden('twitchDisconnectBtn'), true)
  })

  await t.test('without a Client ID there is nothing to ask', async () => {
    Object.assign(state.twitch, { configured: false, connected: false })
    let requested = false
    const original = globalThis.fetch
    globalThis.fetch = async (...args) => {
      requested = true
      return original(...args)
    }

    try {
      await refreshTwitchStatus()
    } finally {
      globalThis.fetch = original
    }

    assert.equal(requested, false)
  })
})

const waiting = (expiresAt) => ({ userCode: 'ABCD-1234', verificationUri: 'https://www.twitch.tv/activate', expiresAt })

test('a login that waits for its code', async (t) => {
  t.beforeEach(() => {
    Object.assign(state.twitch, { configured: true, connected: false, user: null, health: null, offlineWarning: false, authorization: null })
    document.getElementById('toastContainer').innerHTML = ''
  })

  await t.test('is shown with its code and address by a page that was loaded (or reloaded) while the login waits', async () => {
    status = { connected: false, user: null, authorization: waiting(Date.now() + 60_000) }

    await refreshTwitchStatus()
  })

  await t.test('goes away, with a message, when nobody entered the code in time', async () => {
    state.twitch.authorization = waiting(Date.now() - 1000)
    status = { connected: false, user: null, authorization: null }

    await refreshTwitchStatus()

    assert.ok(document.getElementById('toastContainer').textContent.includes('twitchAuthExpired'))
  })

  await t.test('goes away quietly when it was replaced or refused before its time', async () => {
    state.twitch.authorization = waiting(Date.now() + 10 * 60_000)
    status = { connected: false, user: null, authorization: null }

    await refreshTwitchStatus()

    assert.equal(document.getElementById('toastContainer').textContent, '')
  })

  await t.test('shows the newest code when it was replaced by another one', async () => {
    state.twitch.authorization = waiting(Date.now() + 60_000)
    status = { connected: false, user: null, authorization: { ...waiting(Date.now() + 120_000), userCode: 'WXYZ-9876' } }

    await refreshTwitchStatus()

    assert.equal(document.getElementById('toastContainer').textContent, '')
  })

  await t.test('turns the connect button into "reconnect" (not a disabled one) while it waits, and back when it is over', async () => {
    const button = el('twitchConnectBtn')

    renderTwitchConnection()
    assert.equal(button.getAttribute('data-i18n'), 'settings.twitch.connect')

    status = { connected: false, user: null, authorization: waiting(Date.now() + 60_000) }
    await refreshTwitchStatus()
    assert.equal(button.disabled, false)
    assert.equal(hidden('twitchConnectBtn'), false)

    state.twitch.authorization = waiting(Date.now() - 1000)
    status = { connected: false, user: null, authorization: null }
    await refreshTwitchStatus()
    assert.equal(button.getAttribute('data-i18n'), 'settings.twitch.connect')
  })

  await t.test('is not shown next to an account that is already connected', async () => {
    state.twitch.authorization = waiting(Date.now() + 60_000)
    status = { connected: true, user, health: up, authorization: waiting(Date.now() + 60_000) }

    await refreshTwitchStatus()

    assert.equal(state.twitch.authorization, null)
  })
})
