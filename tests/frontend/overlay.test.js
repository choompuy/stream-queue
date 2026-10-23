import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { setupPanel, installEventSource, installYouTube, flush, deferred, makeTrack as track, V } from './control/panel-env.js'

mock.method(console, 'log', () => {})

const SETTINGS = { locale: 'en', showVideo: true, hideOverlayInfo: false, opacity: 100, position: 'bottom-right' }

let instance = 0

const GRANTED = { request: (name, callback) => callback() }

// A fresh overlay on a fresh page. `server` is what the overlay reads: change it, then call overlay.refresh().
async function boot(t, { current = null, isPaused = false, settings = {}, locks = GRANTED, events = true } = {}) {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })

  const env = setupPanel({ page: 'overlay.html', url: 'http://localhost:4747/overlay' })
  const youtube = installYouTube()
  const sources = events ? installEventSource() : ((globalThis.EventSource = undefined), [])

  const server = { current, isPaused, nextTrack: null }
  const sent = { ended: [], failures: [] }
  const outcomes = { ended: [], failures: [] }

  env.route('GET /api/overlay-state', () => ({ settings: { ...SETTINGS, ...settings }, state: { ...server } }))
  env.route('POST /api/player/ended', (body) => {
    sent.ended.push(body)
    return outcomes.ended.shift() ?? {}
  })
  env.route('POST /api/player/report-failure', (body) => {
    sent.failures.push(body)
    return outcomes.failures.shift() ?? {}
  })

  const { startOverlay } = await import(`../../public/js/overlay.js?instance=${++instance}`)
  const overlay = startOverlay({ locks })
  t.after(() => {
    overlay.stop()
    mock.timers.reset()
  })

  const settle = async () => {
    for (let i = 0; i < 6; i++) await flush()
  }
  const elapse = async (ms) => {
    mock.timers.tick(ms)
    await settle()
  }

  await settle()
  await overlay.refresh()
  await settle()

  return { env, overlay, server, sent, outcomes, sources, settle, elapse, ...youtube, player: () => youtube.players.at(-1) }
}

const refused = [500, { error: 'boom', code: 'SERVER_ERROR' }]

test('the badge', async (t) => {
  await t.test('is hidden while nothing plays', async (t) => {
    const { env } = await boot(t)

    assert.equal(env.$('#badge').classList.contains('visible'), false)
  })

  await t.test('shows the track and who asked for it', async (t) => {
    const { env } = await boot(t, { current: track('a') })

    assert.equal(env.$('#badge').classList.contains('visible'), true)
    assert.equal(env.$('#currentTitle').textContent, 'Track a')
    assert.equal(env.$('#currentRequester').textContent, '@bob')
  })

  await t.test('a playlist track goes by the localized name, not the marker it carries', async (t) => {
    const { env } = await boot(t, { current: track('f', { isFallback: true, requestedBy: 'playlist' }) })

    assert.equal(env.$('#currentTitle').textContent, 'Track f')
    assert.equal(env.$('#currentRequester').textContent, 'Playlist')
  })

  await t.test('follows the display settings: video only, opacity and position', async (t) => {
    const { env } = await boot(t, { current: track('a'), settings: { hideOverlayInfo: true, opacity: 40, position: 'top-left' } })
    const badge = env.$('#badge')

    assert.equal(badge.classList.contains('with-video'), true)
    assert.equal(badge.classList.contains('video-only'), true)
    assert.equal(badge.style.opacity, '40%')
    assert.equal(badge.dataset.position, 'top-left')
  })

  await t.test('is hidden while the server says the player is paused', async (t) => {
    const { env } = await boot(t, { current: track('a'), isPaused: true })

    assert.equal(env.$('#badge').classList.contains('visible'), false)
  })

  await t.test('shows the progress of the player against the length of the track', async (t) => {
    const { env, player, elapse } = await boot(t, { current: track('a') })
    player().time = 30

    await elapse(1000)

    assert.equal(env.$('#progressBar').style.getPropertyValue('--progress'), '30%')
    assert.equal(env.$('#elapsedTimeCurrent').textContent, '0:30')
    assert.equal(env.$('#elapsedTimeEnd').textContent, '/ 1:40')
  })
})

test('the player follows the server', async (t) => {
  await t.test('plays the track of the server once, however often the state is read', async (t) => {
    const { overlay, player, settle } = await boot(t, { current: track('a') })

    await overlay.refresh()
    await overlay.refresh()
    await settle()

    assert.deepEqual(player().calls, [['load', V('a')]])
  })

  await t.test('a new track of the server is loaded', async (t) => {
    const { overlay, server, player, settle } = await boot(t, { current: track('a') })

    server.current = track('b')
    await overlay.refresh()
    await settle()

    assert.deepEqual(player().calls.at(-1), ['load', V('b')])
  })

  await t.test('the same track played again (a new play id) is loaded again', async (t) => {
    const { overlay, server, player, settle } = await boot(t, { current: track('a', { playId: 1 }) })

    server.current = track('a', { playId: 2 })
    await overlay.refresh()
    await settle()

    assert.deepEqual(player().calls, [
      ['load', V('a')],
      ['load', V('a')]
    ])
  })

  await t.test('pause and resume of the server reach the player, and an empty queue stops it', async (t) => {
    const { overlay, server, player, settle } = await boot(t, { current: track('a') })
    const step = async (change) => {
      Object.assign(server, change)
      await overlay.refresh()
      await settle()
      return player().calls.at(-1)[0]
    }

    assert.equal(await step({ isPaused: true }), 'pause')
    assert.equal(await step({ isPaused: false }), 'play')
    assert.equal(await step({ current: null }), 'stop')
  })

  await t.test('a track that starts while the server says paused is only cued', async (t) => {
    const { player } = await boot(t, { current: track('a'), isPaused: true })

    assert.deepEqual(player().calls, [['cue', V('a')]])
  })
})

test('a finished track', async (t) => {
  await t.test('is reported to the server with the video that really ended', async (t) => {
    const { player, sent, settle } = await boot(t, { current: track('a') })

    player().emit('onStateChange', 0)
    await settle()

    assert.deepEqual(sent.ended, [{ videoId: V('a') }])
  })

  await t.test('is reported with the play id of the play that ended', async (t) => {
    const { player, sent, settle } = await boot(t, { current: track('a', { playId: 7 }) })

    player().emit('onStateChange', 0)
    await settle()

    assert.deepEqual(sent.ended, [{ videoId: V('a'), playId: 7 }])
  })

  await t.test('is reported again, with growing pauses, until the server has heard it', async (t) => {
    const { player, sent, outcomes, settle, elapse } = await boot(t, { current: track('a') })
    outcomes.ended.push(refused, refused)

    player().emit('onStateChange', 0)
    await settle()
    assert.equal(sent.ended.length, 1)

    await elapse(499)
    assert.equal(sent.ended.length, 1)
    await elapse(1)
    assert.equal(sent.ended.length, 2)

    await elapse(1000)
    assert.equal(sent.ended.length, 3)
    await elapse(60_000)
    assert.equal(sent.ended.length, 3, 'heard: no more reports')
  })

  await t.test('is not reported again after a refusal that a retry cannot fix', async (t) => {
    const { player, sent, outcomes, settle, elapse } = await boot(t, { current: track('a') })
    outcomes.ended.push([400, { error: 'no', code: 'INVALID_INPUT' }])

    player().emit('onStateChange', 0)
    await settle()
    await elapse(60_000)

    assert.equal(sent.ended.length, 1)
  })

  await t.test('stops at the first answer of the server, also when it says that it did not apply the report: the track was not the current one any more', async (t) => {
    const { player, sent, outcomes, settle, elapse } = await boot(t, { current: track('a') })
    outcomes.ended.push(refused, { applied: false })

    player().emit('onStateChange', 0)
    await settle()
    await elapse(500)
    assert.equal(sent.ended.length, 2)

    await elapse(60_000)
    assert.equal(sent.ended.length, 2)
  })
})

test('a track that cannot be played', async (t) => {
  await t.test('is reported with the error code, and the broken player is replaced by a fresh one', async (t) => {
    const { players, sent, settle } = await boot(t, { current: track('a') })

    players[0].emit('onError', 100)
    await settle()

    assert.deepEqual(sent.failures, [{ errorCode: 100, videoId: V('a') }])
    assert.equal(players.length, 2)
    assert.equal(players[0].destroyed, true)
  })

  await t.test('is reported once, and the player replaced once, even when the player says it twice', async (t) => {
    const { players, sent, settle } = await boot(t, { current: track('a') })

    players[0].emit('onError', 100)
    players[0].emit('onError', 100)
    await settle()

    assert.equal(sent.failures.length, 1)
    assert.equal(players.length, 2)
  })

  await t.test('is reported even when the page never draws a frame, as a hidden OBS source does not', async (t) => {
    const { players, sent, elapse } = await boot(t, { current: track('a') })
    globalThis.requestAnimationFrame = () => {}

    players[0].emit('onError', 100)
    await elapse(100)

    assert.deepEqual(sent.failures, [{ errorCode: 100, videoId: V('a') }])
    assert.equal(players.length, 2)
  })

  await t.test('what a replaced player says is left alone: it is not reported again', async (t) => {
    const { players, sent, settle } = await boot(t, { current: track('a') })

    players[0].emit('onError', 100)
    await settle()
    players[0].emit('onError', 100)
    await settle()

    assert.equal(sent.failures.length, 1)
    assert.equal(players.length, 2)
  })

  await t.test('the new player is not believed while the failure of the old one is still being reported', async (t) => {
    const { env, players, sent, settle } = await boot(t, { current: track('a') })
    let answer = null
    env.route('POST /api/player/report-failure', (body) => {
      sent.failures.push(body)
      return new Promise((resolve) => (answer = resolve))
    })

    players[0].emit('onError', 100)
    await settle()
    assert.equal(players.length, 2)

    // the report is on its way and the server still plays the track, so the new player loads it and fails again
    players[1].emit('onError', 100)
    await settle()
    assert.equal(sent.failures.length, 1)
    assert.equal(players.length, 2, 'and is not replaced once more')

    answer({})
    await settle()
  })

  await t.test('a track that comes back starts again with the retries of a temporary error unused', async (t) => {
    const { overlay, server, players, sent, settle, elapse } = await boot(t, { current: track('a') })
    players[0].emit('onError', 5)
    await elapse(2000)
    players[0].emit('onError', 5)
    await elapse(4000)

    server.current = track('b')
    await overlay.refresh()
    await settle()
    server.current = track('a')
    await overlay.refresh()
    await settle()

    players[0].time = 7
    players[0].emit('onError', 5)
    await elapse(2000)

    assert.deepEqual(sent.failures, [])
    assert.deepEqual(players[0].calls.at(-1), ['load', { videoId: V('a'), startSeconds: 7 }])
  })

  await t.test('a temporary player error (5) is retried from where it was, and only the third one is reported', async (t) => {
    const { players, sent, settle, elapse } = await boot(t, { current: track('a') })
    players[0].time = 12.4

    players[0].emit('onError', 5)
    await settle()
    assert.deepEqual(sent.failures, [])
    await elapse(2000)
    assert.deepEqual(players[0].calls.at(-1), ['load', { videoId: V('a'), startSeconds: 12 }])

    players[0].emit('onError', 5)
    await elapse(4000)
    assert.equal(players[0].calls.filter(([name]) => name === 'load').length, 3)
    assert.deepEqual(sent.failures, [])

    players[0].emit('onError', 5)
    await settle()
    assert.deepEqual(sent.failures, [{ errorCode: 5, videoId: V('a') }])
  })
})

test('a track that does not start', async (t) => {
  const loads = (player) => player.calls.filter(([name]) => name === 'load').length

  await t.test('is retried like a temporary player error, and reported when the retries are used up', async (t) => {
    const { players, sent, settle, elapse } = await boot(t, { current: track('a') })
    assert.equal(loads(players[0]), 1)

    await elapse(25_000)
    await elapse(2000)
    assert.equal(loads(players[0]), 2)
    assert.deepEqual(sent.failures, [])

    await elapse(25_000)
    await elapse(4000)
    assert.equal(loads(players[0]), 3)
    assert.deepEqual(sent.failures, [])

    await elapse(25_000)
    await settle()
    assert.deepEqual(sent.failures, [{ errorCode: 5, videoId: V('a') }])
  })

  await t.test('is left alone once it plays', async (t) => {
    const { players, sent, elapse } = await boot(t, { current: track('a') })

    players[0].emit('onStateChange', 1)
    await elapse(120_000)

    assert.equal(loads(players[0]), 1)
    assert.deepEqual(sent.failures, [])
  })

  await t.test('is not waited for while the queue is paused', async (t) => {
    const { players, sent, elapse } = await boot(t, { current: track('a'), isPaused: true })

    await elapse(120_000)

    assert.equal(loads(players[0]), 0)
    assert.deepEqual(sent.failures, [])
  })
})

test('the progress', async (t) => {
  const progress = (env) => env.$('#progressBar').style.getPropertyValue('--progress')

  await t.test('of a live stream has no length to be counted against: nothing is written', async (t) => {
    const { env, players, elapse } = await boot(t, { current: track('a', { duration: 0 }) })
    players[0].time = 5

    await elapse(1000)

    assert.equal(progress(env), '')
    assert.equal(env.$('#progressBar').classList.contains('hidden'), true)
  })

  await t.test('does not go past 100%', async (t) => {
    const { env, players, elapse } = await boot(t, { current: track('a', { duration: 100 }) })
    players[0].time = 130

    await elapse(1000)

    assert.equal(progress(env), '100%')
  })
})

test('which overlay plays', async (t) => {
  await t.test('an overlay that does not hold the lock shows the badge but has no player, and gets one when the lock is granted', async (t) => {
    let grant = null
    const locks = { request: (name, callback) => (grant = callback) }
    const { env, players, settle } = await boot(t, { current: track('a'), locks })

    assert.equal(players.length, 0)
    assert.equal(env.$('#nowPlayingVideo').classList.contains('hidden'), true)
    assert.equal(env.$('#progressWrapper').classList.contains('hidden'), true, 'no player, no time to show')
    assert.equal(env.$('#currentTitle').textContent, 'Track a')

    grant()
    await settle()

    assert.equal(players.length, 1)
    assert.equal(env.$('#nowPlayingVideo').classList.contains('hidden'), false)
    assert.equal(env.$('#progressWrapper').classList.contains('hidden'), false)
  })
})

test('reading the state', async (t) => {
  const reads = (env) => env.count('GET /api/overlay-state')

  await t.test('a change announced by the server is read at once', async (t) => {
    const { env, sources, elapse } = await boot(t, { current: track('a') })
    sources.at(-1).emit('open')
    await elapse(100)
    const before = reads(env)

    sources.at(-1).emit('changed', { topic: 'state' })
    await elapse(100)

    assert.equal(reads(env), before + 1)
  })

  await t.test('a change announced while a read is running is read once more after it', async (t) => {
    const { env, sources, elapse, settle } = await boot(t, { current: track('a') })
    sources.at(-1).emit('open')
    await elapse(100)
    const before = reads(env)

    const slow = deferred()
    env.route('GET /api/overlay-state', () => slow.promise)

    sources.at(-1).emit('changed', { topic: 'state' })
    await elapse(100)
    sources.at(-1).emit('changed', { topic: 'state' })
    await elapse(100)
    assert.equal(reads(env), before + 1)

    slow.resolve({ settings: SETTINGS, state: { current: null, isPaused: false, nextTrack: null } })
    await settle()
    await settle()

    assert.equal(reads(env), before + 2)
  })

  await t.test('without events the page does not read automatically', async (t) => {
    const { env, elapse } = await boot(t, { current: track('a'), events: false })
    const before = reads(env)

    for (let i = 0; i < 3; i++) await elapse(1000)

    assert.equal(reads(env), before)
  })

  await t.test('with the events open it does not read on its own: the server says when', async (t) => {
    const { env, sources, elapse } = await boot(t, { current: track('a') })
    sources.at(-1).emit('open')
    await elapse(100)
    const before = reads(env)

    for (let i = 0; i < 45; i++) await elapse(1000)

    assert.equal(reads(env), before)
  })
})
