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
const { renderTwitchConnection, readTwitchStatus } = await import('../../../public/js/control/twitch/twitch-connection.js')

const el = (id) => document.getElementById(id)
const hidden = (id) => el(id).classList.contains('hidden')

const user = { displayName: 'Streamer', login: 'streamer', profileImageUrl: 'https://example.com/a.png' }

function connected() {
  Object.assign(state.twitch, { configured: true, connected: true, user })
}

test('without a Client ID', async (t) => {
  await t.test('only the note is shown: no channel block, no avatar without a source', () => {
    Object.assign(state.twitch, { configured: false, connected: false, user: null })
    renderTwitchConnection()

    assert.equal(hidden('twitchNotConfigured'), false)
    assert.equal(hidden('twitchChannelField'), true)
    assert.equal(hidden('twitchChanelImg'), true)
    assert.equal(el('twitchChanelImg').hasAttribute('src'), false)
  })
})

test('the avatar', async (t) => {
  await t.test('has a source only while connected', () => {
    connected()
    renderTwitchConnection()
    assert.equal(el('twitchChanelImg').getAttribute('src'), user.profileImageUrl)
    assert.equal(hidden('twitchChanelImg'), false)

    Object.assign(state.twitch, { connected: false, user: null })
    renderTwitchConnection()
    assert.equal(el('twitchChanelImg').hasAttribute('src'), false)
    assert.equal(hidden('twitchChanelImg'), true)
  })
})

test('an account disconnected elsewhere is shown as disconnected', async () => {
  connected()
  status = { connected: false, user: null }
  await readTwitchStatus()
  assert.equal(state.twitch.connected, false)
  assert.equal(hidden('twitchDisconnectBtn'), true)
})

test('a connection made elsewhere', async (t) => {
  await t.test('shows up on the next refresh, also on a page that was reloaded in the middle of the login', async () => {
    // the panel was loaded while nobody was logged in; the login is finished later, in another tab
    Object.assign(state.twitch, { configured: true, connected: false, user: null })
    renderTwitchConnection()
    assert.equal(hidden('twitchDisconnectBtn'), true)

    status = { connected: true, user, connectedAt: 1700000000000 }
    await readTwitchStatus()

    assert.equal(state.twitch.connected, true)
    assert.equal(state.twitch.user.displayName, 'Streamer')
    assert.equal(el('twitchChanelName').textContent, '@Streamer')
    assert.equal(hidden('twitchDisconnectBtn'), false)
    assert.equal(hidden('twitchConnectBtn'), true)
    assert.equal(hidden('twitchRewardSection'), false)
  })

  await t.test('the rewards are loaded once, when the account turns up, and not on every refresh', async () => {
    Object.assign(state.twitch, { configured: true, connected: false, user: null })
    status = { connected: true, user }
    let rewardRequests = 0
    const original = globalThis.fetch
    globalThis.fetch = async (url, ...rest) => {
      if (String(url).includes('/rewards')) rewardRequests++
      return original(url, ...rest)
    }

    try {
      await readTwitchStatus()
      await readTwitchStatus()
    } finally {
      globalThis.fetch = original
    }

    assert.equal(rewardRequests, 1)
  })

  await t.test('an account that is not connected is still asked about, so that a later login is seen', async () => {
    Object.assign(state.twitch, { configured: true, connected: false, user: null })
    status = { connected: false, user: null }
    let requested = false
    const original = globalThis.fetch
    globalThis.fetch = async (...args) => {
      requested = true
      return original(...args)
    }

    try {
      await readTwitchStatus()
    } finally {
      globalThis.fetch = original
    }

    assert.equal(requested, true)
    assert.equal(state.twitch.connected, false)
    renderTwitchConnection()
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
      await readTwitchStatus()
    } finally {
      globalThis.fetch = original
    }

    assert.equal(requested, false)
  })
})

const waiting = (expiresAt) => ({ state: 'pending', userCode: 'ABCD-1234', verificationUri: 'https://www.twitch.tv/activate', expiresAt })
const ended = (state, expiresAt) => ({ state, expiresAt })

test('a login that waits for its code', async (t) => {
  t.beforeEach(() => {
    Object.assign(state.twitch, { configured: true, connected: false, user: null, authorization: null })
    document.getElementById('toastContainer').innerHTML = ''
  })

  await t.test('is shown with its code and address by a page that was loaded (or reloaded) while the login waits', async () => {
    status = { connected: false, user: null, authorization: waiting(Date.now() + 60_000) }

    await readTwitchStatus()
  })

  await t.test('goes away, with a message, when nobody entered the code in time: the server says it expired', async () => {
    state.twitch.authorization = waiting(Date.now() - 1000)
    status = { connected: false, user: null, authorization: ended('expired', Date.now() - 1000) }

    await readTwitchStatus()

    assert.ok(document.getElementById('toastContainer').textContent.includes('twitchAuthExpired'))
  })

  await t.test('goes away quietly when it was refused (a refused login has its own message from the server)', async () => {
    state.twitch.authorization = waiting(Date.now() + 10 * 60_000)
    status = { connected: false, user: null, authorization: ended('denied', Date.now()) }

    await readTwitchStatus()

    assert.equal(document.getElementById('toastContainer').textContent, '')
  })

  await t.test('shows the newest code when it was replaced by another one', async () => {
    state.twitch.authorization = waiting(Date.now() + 60_000)
    status = { connected: false, user: null, authorization: { ...waiting(Date.now() + 120_000), userCode: 'WXYZ-9876' } }

    await readTwitchStatus()

    assert.equal(document.getElementById('toastContainer').textContent, '')
  })

  await t.test('turns the connect button into "reconnect" (not a disabled one) while it waits, and back when it is over', async () => {
    const button = el('twitchConnectBtn')

    renderTwitchConnection()
    assert.equal(button.getAttribute('data-i18n'), 'settings.twitch.connect')

    status = { connected: false, user: null, authorization: waiting(Date.now() + 60_000) }
    await readTwitchStatus()
    assert.equal(button.disabled, false)
    assert.equal(hidden('twitchConnectBtn'), false)

    state.twitch.authorization = waiting(Date.now() - 1000)
    status = { connected: false, user: null, authorization: ended('expired', Date.now() - 1000) }
    await readTwitchStatus()
    assert.equal(button.getAttribute('data-i18n'), 'settings.twitch.connect')
  })

  await t.test('is not shown next to an account that is already connected', async () => {
    state.twitch.authorization = waiting(Date.now() + 60_000)
    status = { connected: true, user, authorization: waiting(Date.now() + 60_000) }

    await readTwitchStatus()

    assert.equal(state.twitch.authorization, null)
  })
})
