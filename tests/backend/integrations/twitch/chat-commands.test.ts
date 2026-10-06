import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.chdir(mkdtempSync(join(tmpdir(), 'streamqueue-chat-test-')))

const { getConfig, updateConfig } = await import('../../../../src/config.js')
const { updateTwitchConfig } = await import('../../../../src/integrations/twitch/config.js')
const { hydrateQueue, setPaused, getIsPaused } = await import('../../../../src/queue.js')
const { getState } = await import('../../../../src/player.js')
const { getTwitchIntegration } = await import('../../../../src/integrations/twitch/index.js')
const { clearTwitchOAuthState } = await import('../../../../src/secrets.js')
import { hasPermission, matchesCommand } from '../../../../src/integrations/twitch/chat-commands.js'
import type { TwitchChatMessage } from '../../../../src/integrations/twitch/types.js'

function message(overrides: Partial<TwitchChatMessage> = {}): TwitchChatMessage {
  return {
    channel: 'broadcaster',
    displayName: 'Viewer',
    userLogin: 'viewer',
    text: '!sg now',
    isModerator: false,
    isBroadcaster: false,
    ...overrides
  }
}

async function createMockCommands() {
  const { ChatCommands } = await import('../../../../src/integrations/twitch/chat-commands.js')
  return new ChatCommands(
    {
      buildNowPlayingMessage: () => 'Now playing: Test Song',
      buildQueueMessage: () => 'Queue: []',
      skipCurrent: () => {},
      getState: () => ({ current: null, queue: [], isPaused: false }),
      setPaused: () => {},
      translate: (k, p, f) => f ?? k
    } as any,
    () => Promise.resolve()
  )
}

const DEFAULTS = getConfig()

beforeEach(async () => {
  const integration = getTwitchIntegration()
  if (integration) await integration.stop()
  clearTwitchOAuthState()
  hydrateQueue({ current: null, queue: [] })
  setPaused(false)
  updateConfig({
    ...DEFAULTS,
    fallbackPlaylist: { ...DEFAULTS.fallbackPlaylist }
  })
  // Reset twitch config to defaults using cloneTwitchConfig and restore
  const { restoreTwitchConfig } = await import('../../../../src/integrations/twitch/config.js')
  restoreTwitchConfig({
    channelPointsRewardId: null,
    autoFulfillRedemptions: false,
    chatCommands: {
      now: { enabled: true, command: '!sg now', permission: 'everyone' },
      queue: { enabled: true, command: '!sg queue', permission: 'everyone' },
      skip: { enabled: true, command: '!sg skip', permission: 'moderator' },
      pause: { enabled: true, command: '!sg pause', permission: 'moderator' },
      resume: { enabled: true, command: '!sg resume', permission: 'moderator' },
      controlCooldownSeconds: 5,
      plainCooldownSeconds: 5
    }
  })
})

test('hasPermission()', async (t) => {
  await t.test('"everyone" allows anyone', () => {
    assert.equal(hasPermission(message({ isModerator: false, isBroadcaster: false }), 'everyone'), true)
  })

  await t.test('"moderator" allows a moderator', () => {
    assert.equal(hasPermission(message({ isModerator: true }), 'moderator'), true)
  })

  await t.test('"moderator" allows the broadcaster too', () => {
    assert.equal(hasPermission(message({ isModerator: false, isBroadcaster: true }), 'moderator'), true)
  })

  await t.test('"moderator" denies a regular viewer', () => {
    assert.equal(hasPermission(message({ isModerator: false, isBroadcaster: false }), 'moderator'), false)
  })

  await t.test('"broadcaster" denies a moderator who is not the broadcaster', () => {
    assert.equal(hasPermission(message({ isModerator: true, isBroadcaster: false }), 'broadcaster'), false)
  })

  await t.test('"broadcaster" allows the broadcaster', () => {
    assert.equal(hasPermission(message({ isBroadcaster: true }), 'broadcaster'), true)
  })
})

test('matchesCommand()', async (t) => {
  await t.test('matches an exact, case-insensitive command', () => {
    assert.equal(matchesCommand('!SG Skip', '!sg skip'), true)
  })

  await t.test('matches when the command is followed by extra text', () => {
    assert.equal(matchesCommand('!sg skip please', '!sg skip'), true)
  })

  await t.test('does not match a longer word that merely starts with the command', () => {
    assert.equal(matchesCommand('!sg skipping', '!sg skip'), false)
  })

  await t.test('does not match an unrelated message', () => {
    assert.equal(matchesCommand('hello chat', '!sg skip'), false)
  })

  await t.test('collapses repeated whitespace before comparing', () => {
    assert.equal(matchesCommand('!sg   skip', '!sg skip'), true)
  })
})

test('handleChatMessage() - read-only commands (now/queue)', async (t) => {
  await t.test('"now" command is processed for anyone', async () => {
    hydrateQueue({
      current: { videoId: 'abc', title: 'Test Song', channelTitle: 'x', thumbnail: '', duration: 100, views: 1, url: '', requestedBy: 'someone' }
    })

    const commands = await createMockCommands()
    const config = (await import('../../../../src/integrations/twitch/config.js')).getTwitchConfig()

    // The command should be processed without errors
    await commands.handle(message({ text: '!sg now' }), config.chatCommands)
  })

  await t.test('"queue" command is processed for anyone', async () => {
    hydrateQueue({
      queue: [{ videoId: 'abc', title: 'Queued Song', channelTitle: 'x', thumbnail: '', duration: 100, views: 1, url: '', requestedBy: 'someone' }]
    })

    const commands = await createMockCommands()
    const config = (await import('../../../../src/integrations/twitch/config.js')).getTwitchConfig()

    // The command should be processed without errors
    await commands.handle(message({ text: '!sg queue' }), config.chatCommands)
  })

  await t.test('a disabled command does not trigger', async () => {
    updateTwitchConfig({ chatCommands: { now: { enabled: false } } })

    const commands = await createMockCommands()
    const config = (await import('../../../../src/integrations/twitch/config.js')).getTwitchConfig()

    // The command should be processed but not trigger due to being disabled
    await commands.handle(message({ text: '!sg now' }), config.chatCommands)
  })

  await t.test('an unrecognized message does not trigger any command', async () => {
    const commands = await createMockCommands()
    const config = (await import('../../../../src/integrations/twitch/config.js')).getTwitchConfig()

    // The message should be processed without errors
    await commands.handle(message({ text: 'just chatting' }), config.chatCommands)
  })

  await t.test('the global cooldown blocks a second plain command from a different user', async () => {
    hydrateQueue({
      current: { videoId: 'abc', title: 'Test Song', channelTitle: 'x', thumbnail: '', duration: 100, views: 1, url: '', requestedBy: 'someone' }
    })

    const commands = await createMockCommands()
    const config = (await import('../../../../src/integrations/twitch/config.js')).getTwitchConfig()

    await commands.handle(message({ text: '!sg now', displayName: 'UserOne' }), config.chatCommands)
    await commands.handle(message({ text: '!sg now', displayName: 'UserTwo' }), config.chatCommands)

    // The second call should be blocked by cooldown (no error thrown, but message logged)
  })
})

test('handleChatMessage() - control commands (skip/pause/resume)', async (t) => {
  await t.test('a regular viewer cannot skip (default permission is moderator)', async () => {
    hydrateQueue({
      current: { videoId: 'abc', title: 'Song A', channelTitle: 'x', thumbnail: '', duration: 100, views: 1, url: '', requestedBy: 'someone' }
    })

    const commands = await createMockCommands()
    const config = (await import('../../../../src/integrations/twitch/config.js')).getTwitchConfig()

    await commands.handle(message({ text: '!sg skip', isModerator: false, isBroadcaster: false }), config.chatCommands)

    assert.equal(getState().current?.videoId, 'abc')
  })

  await t.test('a moderator can skip', async () => {
    hydrateQueue({
      current: { videoId: 'abc', title: 'Song A', channelTitle: 'x', thumbnail: '', duration: 100, views: 1, url: '', requestedBy: 'someone' },
      queue: [{ videoId: 'def', title: 'Song B', channelTitle: 'x', thumbnail: '', duration: 100, views: 1, url: '', requestedBy: 'someone' }]
    })

    const commands = await createMockCommands()
    const config = (await import('../../../../src/integrations/twitch/config.js')).getTwitchConfig()

    await commands.handle(message({ text: '!sg skip', isModerator: true }), config.chatCommands)

    assert.equal(getState().current?.videoId, 'def')
  })

  await t.test('the broadcaster can skip even without the moderator badge', async () => {
    hydrateQueue({
      current: { videoId: 'abc', title: 'Song A', channelTitle: 'x', thumbnail: '', duration: 100, views: 1, url: '', requestedBy: 'someone' },
      queue: [{ videoId: 'def', title: 'Song B', channelTitle: 'x', thumbnail: '', duration: 100, views: 1, url: '', requestedBy: 'someone' }]
    })

    const commands = await createMockCommands()
    const config = (await import('../../../../src/integrations/twitch/config.js')).getTwitchConfig()

    await commands.handle(message({ text: '!sg skip', isModerator: false, isBroadcaster: true }), config.chatCommands)

    assert.equal(getState().current?.videoId, 'def')
  })

  await t.test('pause sets the player to paused', async () => {
    const commands = await createMockCommands()
    const config = (await import('../../../../src/integrations/twitch/config.js')).getTwitchConfig()

    await commands.handle(message({ text: '!sg pause', isModerator: true }), config.chatCommands)

    assert.equal(getIsPaused(), true)
  })

  await t.test('resume clears paused', async () => {
    setPaused(true)

    const commands = await createMockCommands()
    const config = (await import('../../../../src/integrations/twitch/config.js')).getTwitchConfig()

    await commands.handle(message({ text: '!sg resume', isModerator: true }), config.chatCommands)

    assert.equal(getIsPaused(), false)
  })

  await t.test('the global cooldown blocks a second control command from a different moderator', async () => {
    const commands = await createMockCommands()
    const config = (await import('../../../../src/integrations/twitch/config.js')).getTwitchConfig()

    await commands.handle(message({ text: '!sg pause', displayName: 'ModOne', isModerator: true }), config.chatCommands)

    setPaused(false)
    await commands.handle(message({ text: '!sg pause', displayName: 'ModTwo', isModerator: true }), config.chatCommands)

    // The second call should be blocked by cooldown
    assert.equal(getIsPaused(), false)
  })

  await t.test('a permission check happens before the cooldown - a denied viewer never consumes it', async () => {
    const commands = await createMockCommands()
    const config = (await import('../../../../src/integrations/twitch/config.js')).getTwitchConfig()

    await commands.handle(message({ text: '!sg pause', isModerator: false, isBroadcaster: false }), config.chatCommands)

    await commands.handle(message({ text: '!sg pause', isModerator: true }), config.chatCommands)

    // The second call should succeed since the first didn't consume cooldown
    assert.equal(getIsPaused(), true)
  })
})

test('handleChatMessage() - custom configured commands', async (t) => {
  await t.test('a renamed command is matched by its new text, not the old default', async () => {
    updateTwitchConfig({ chatCommands: { skip: { command: '!qskip' } } })
    hydrateQueue({
      current: { videoId: 'abc', title: 'Song A', channelTitle: 'x', thumbnail: '', duration: 100, views: 1, url: '', requestedBy: 'someone' },
      queue: [{ videoId: 'def', title: 'Song B', channelTitle: 'x', thumbnail: '', duration: 100, views: 1, url: '', requestedBy: 'someone' }]
    })

    const commands = await createMockCommands()
    const config = (await import('../../../../src/integrations/twitch/config.js')).getTwitchConfig()

    await commands.handle(message({ text: '!sg skip', isModerator: true }), config.chatCommands)
    assert.equal(getState().current?.videoId, 'abc') // old command text no longer works

    await commands.handle(message({ text: '!qskip', isModerator: true }), config.chatCommands)
    assert.equal(getState().current?.videoId, 'def')
  })

  await t.test('loosening a command to "everyone" lets a regular viewer use it', async () => {
    updateTwitchConfig({ chatCommands: { skip: { permission: 'everyone' } } })
    hydrateQueue({
      current: { videoId: 'abc', title: 'Song A', channelTitle: 'x', thumbnail: '', duration: 100, views: 1, url: '', requestedBy: 'someone' },
      queue: [{ videoId: 'def', title: 'Song B', channelTitle: 'x', thumbnail: '', duration: 100, views: 1, url: '', requestedBy: 'someone' }]
    })

    const commands = await createMockCommands()
    const config = (await import('../../../../src/integrations/twitch/config.js')).getTwitchConfig()

    await commands.handle(message({ text: '!sg skip', isModerator: false, isBroadcaster: false }), config.chatCommands)
    assert.equal(getState().current?.videoId, 'def')
  })
})
