import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setupPanel } from './panel-env.js'

const panel = setupPanel()

const { initI18n } = await import('../../../public/js/i18n.js')
await initI18n('en')
const { state, isLocalDevice } = await import('../../../public/js/control/state.js')
const { loadNetworkInfo } = await import('../../../public/js/control/settings.js')
const { refreshTwitchStatus } = await import('../../../public/js/control/twitch/twitch-connection.js')
const { loadTwitchConfig } = await import('../../../public/js/control/twitch/index.js')

const networkInfo = (isLocal) => ({ port: 4747, ips: isLocal ? ['localhost'] : ['192.168.1.5'], isLocal })

const connected = { connected: true, user: { displayName: 'Streamer', login: 'streamer', profileImageUrl: '' }, health: null }

test('the page knows which blocks another device may not change', async (t) => {
  await t.test('the machine-only blocks are marked in the page: the API key, the Twitch section, the chat commands', () => {
    assert.ok(panel.$('#secYoutubeKey')?.closest('.local-only'), 'the API key field is inside a machine-only block')
    assert.ok(panel.$('#twitchChatCommandsPanel')?.classList.contains('local-only'))
    assert.ok(panel.$('[data-i18n="settings.twitch.integration"]')?.closest('.local-only'), 'the Twitch section is machine-only')
  })

  await t.test('the note that replaces them is marked to be shown to another device only', () => {
    assert.ok(panel.$('#remoteSettingsNote')?.classList.contains('remote-only'))
    assert.equal(panel.$('#remoteSettingsNote').getAttribute('data-i18n'), 'settings.remoteNote')
  })
})

test('loadNetworkInfo()', async (t) => {
  await t.test('an answer from this machine leaves the page as it is', async () => {
    panel.route('GET /api/network-info', networkInfo(true))

    await loadNetworkInfo()

    assert.equal(isLocalDevice(), true)
    assert.equal(document.body.classList.contains('not-local'), false)
  })

  await t.test('an answer from another device marks the page: the CSS hides the machine-only blocks and shows the note', async () => {
    panel.route('GET /api/network-info', networkInfo(false))

    await loadNetworkInfo()

    assert.equal(isLocalDevice(), false)
    assert.equal(document.body.classList.contains('not-local'), true)
  })

  await t.test('a page that has not asked yet counts as this machine: hiding working settings is worse than showing refused ones', () => {
    state.network = null

    assert.equal(isLocalDevice(), true)
  })
})

test('another device reads nothing from the Twitch section', async (t) => {
  // the server refuses the whole section with LOCAL_ONLY, so the panel does not even ask
  panel.route('GET /api/network-info', networkInfo(false))
  await loadNetworkInfo()

  state.twitch.configured = true
  Object.assign(state.twitch, { connected: true, user: connected.user })
  panel.route('GET /api/integrations/twitch', connected)
  panel.route('GET /api/integrations/twitch/config', { channelPointsRewardId: '' })
  panel.route('GET /api/integrations/twitch/rewards', { rewards: [] })
  panel.calls.length = 0

  await t.test('the loaders the panel runs at its start ask nothing', async () => {
    const before = panel.toasts().join('|')

    await refreshTwitchStatus()
    await loadTwitchConfig()

    assert.deepEqual(panel.calls, [], 'no request may leave: each one would only come back refused')
    assert.equal(panel.toasts().join('|'), before, 'a refusal toast on every load is what made the settings look broken')
  })

  await t.test('the same loads on this machine still read as they did', async () => {
    panel.route('GET /api/network-info', networkInfo(true))
    await loadNetworkInfo()
    Object.assign(state.twitch, { connected: false, user: null })
    panel.calls.length = 0

    await loadTwitchConfig()
    await refreshTwitchStatus()

    assert.deepEqual(panel.calls, [
      'GET /api/integrations/twitch/config',
      'GET /api/integrations/twitch',
      'GET /api/integrations/twitch/rewards'
    ])
  })

  await t.test('without an answer yet the loads still run, as they did before', async () => {
    state.network = null
    Object.assign(state.twitch, { connected: false, user: null })
    panel.calls.length = 0

    await refreshTwitchStatus()

    assert.deepEqual(panel.calls, ['GET /api/integrations/twitch', 'GET /api/integrations/twitch/rewards'])
  })
})
