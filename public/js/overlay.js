import { $, createLogger, describeTrack, formatDuration, formatTrackDuration, show } from './shared.js'
import { initI18n, getCurrentLocale } from './i18n.js'
import { loadYouTubeApi } from './youtube-api.js'
import { claimPlayback } from './playback-lock.js'
import { watch } from './watch.js'
import { request } from './http.js'

let settings = {}
let localeLoaded = false
// what the server said last, as the drawing of the page knows it
let currentState = null
// reads the state: what the server announces, and what is read while the events are down (see watch)
let watcher = null

const log = createLogger('PREVIEW')

// only one overlay on this computer plays the music: the others (and any overlay opened by another address) just show the badge
let isPlaybackSource = false

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// the elements of overlay.html, found when the overlay starts
let dom = null

const readState = () => watcher.refresh('state')

async function fetchOverlayState() {
  let data

  try {
    data = await request('/api/overlay-state')
  } catch (error) {
    log('Reading the state failed:', error)
    return
  }

  settings = data.settings
  currentState = data.state
  const serverLocale = settings.locale || 'en'
  if (!localeLoaded || serverLocale !== getCurrentLocale()) {
    await initI18n(serverLocale)
    localeLoaded = true
  }

  // a fault of the drawing is not one of the network: it is not hidden behind the message of a failed read (the watcher logs it)
  renderState()
}

/**
 * The playback of the overlay: one YouTube player and the play it is at. `sync({ current, isPaused })` is its whole
 * interface — whatever the server says (a new track, a pause, a resume, an empty queue) is reconciled with what the
 * player is doing. `phase` is where the play is:
 *
 *   'idle'    nothing to play, or no player to play it on (yet)
 *   'cued'    a track is cued while the server says paused
 *   'playing' the current track is playing
 *   'paused'  the server says paused, and so is the player
 *   'ending'  a track ended and its report is on its way
 *   'failing' a track cannot play: the player is being replaced and the failure reported
 */
function createPlayback({ isWanted, reportEnded, reportFailure, onReady }) {
  const TEMPORARY_PLAYER_ERROR = 5
  const MAX_TEMPORARY_ERROR_RETRIES = 2
  // A track that does not start (no network in OBS, an autoplay that is blocked: the player says nothing then) would hold
  // the queue for ever. Not playing after this long counts as a temporary player error: retried, and reported when the
  // retries are used up
  const START_TIMEOUT_MS = 25_000

  let player = null
  let ready = false
  let phase = 'idle'
  // the play the player was last loaded for: a new value means the same track is played again
  let loadedPlayId = null
  let synced = { current: null, isPaused: false }
  let watchdog = null
  const retries = new Map()

  const videoId = () => synced.current?.videoId ?? null

  function clearWatchdog() {
    clearTimeout(watchdog)
    watchdog = null
  }

  // answers the wait for the track to start; a retry waits again, and a failure is reported
  function armWatchdog() {
    clearWatchdog()
    const watched = player
    const watchedId = videoId()

    watchdog = setTimeout(() => {
      watchdog = null
      if (player !== watched || videoId() !== watchedId || synced.isPaused) return

      log(`${watchedId} did not start playing in ${START_TIMEOUT_MS / 1000} s`)
      handleError({ data: TEMPORARY_PLAYER_ERROR, target: watched })
    }, START_TIMEOUT_MS)
  }

  function configurePlayer() {
    if (!player) return

    try {
      player.setOption('captions', 'fontSize', 0)
      player.unloadModule('captions')
    } catch (error) {
      log('Error configuring player:', error)
    }
  }

  // Returns true when a retry has been scheduled, so the failure is not reported yet
  function retryTemporaryError(errorCode, failedVideoId, failedPlayer) {
    if (errorCode !== TEMPORARY_PLAYER_ERROR) return false

    const used = retries.get(failedVideoId) ?? 0
    if (used >= MAX_TEMPORARY_ERROR_RETRIES) return false

    retries.set(failedVideoId, used + 1)
    log(`Temporary player error, retry ${used + 1}/${MAX_TEMPORARY_ERROR_RETRIES} for ${failedVideoId}`)

    // taken now, while the player still knows where it was: the retry continues from there instead of from the start
    const startSeconds = Math.max(0, Math.floor(Number(player?.getCurrentTime?.()) || 0))

    setTimeout(
      () => {
        // the events of a player that was replaced come from an object that is not `player` any more, and are left alone
        const stillCurrent = player === failedPlayer && videoId() === failedVideoId
        if (!stillCurrent) return

        if (synced.isPaused) {
          player.cueVideoById({ videoId: failedVideoId, startSeconds })
        } else {
          player.loadVideoById({ videoId: failedVideoId, startSeconds })
          armWatchdog()
        }
      },
      2000 * (used + 1)
    )

    return true
  }

  function createPlayer() {
    if (!isWanted() || typeof YT === 'undefined' || !YT.Player) return

    player = new YT.Player('player', {
      width: '100%',
      height: '100%',

      playerVars: {
        autoplay: 0,
        controls: 0,
        rel: 0,
        fs: 0,
        cc_load_policy: 0,
        iv_load_policy: 3,
        disablekb: 1,
        playsinline: 1
      },

      events: {
        onReady: (event) => {
          if (event.target === player) handleReady(event)
        },

        onStateChange: (event) => {
          if (event.target === player) handleStateChange(event)
        },

        onError: (event) => {
          if (event.target === player) handleError(event)
        }
      }
    })

    log('YouTube player created')
  }

  // a broken player is replaced by a fresh one on a fresh element
  async function resetPlayer() {
    clearWatchdog()
    const oldPlayer = player

    player = null
    ready = false

    if (oldPlayer) {
      try {
        oldPlayer.destroy()
        log('YouTube player destroyed')
      } catch (error) {
        log('Error destroying YouTube player:', error)
      }
    }

    const oldElement = $('player')

    if (oldElement) {
      const newElement = document.createElement('div')
      newElement.id = 'player'
      oldElement.replaceWith(newElement)
    }

    // one frame for the page to drop the old player. A page that is not shown (an OBS source that is hidden) never draws one,
    // and the failure must not wait for it: the queue stands until the failure is reported
    await Promise.race([new Promise((resolve) => requestAnimationFrame(resolve)), sleep(100)])

    createPlayer()
  }

  function handleReady(event) {
    log('Player ready')
    ready = true
    event.target.setVolume(100)
    configurePlayer()
    onReady()
  }

  function handleStateChange(event) {
    log(`Player state: ${event.data}`)

    if (event.data === YT.PlayerState.PLAYING) clearWatchdog()

    if (event.data === YT.PlayerState.ENDED && phase !== 'ending') {
      log('Video ended, requesting next')
      phase = 'ending'
      // the track that actually finished in the player, which may differ from what the server considers current now
      const endedVideoId = event.target.getVideoData?.().video_id || videoId()
      reportEnded(endedVideoId, loadedPlayId).finally(() => {
        // the read that follows the report decides the phase; until it arrives there is nothing playing here
        phase = 'idle'
      })
    }
  }

  function handleError(event) {
    // an error answers the wait: a retry waits again, and a failure is reported
    clearWatchdog()
    log(`Player error: ${event.data}`)
    const failedVideoId = videoId()

    if (!failedVideoId) {
      log('Player error without current video')
      return
    }

    if (phase === 'failing') {
      log('Ignoring a player error while the player is being replaced')
      return
    }

    if (retryTemporaryError(event.data, failedVideoId, event.target)) return

    phase = 'failing'
    resetPlayer()
      .then(() => reportFailure(event.data, failedVideoId, loadedPlayId))
      .finally(() => {
        phase = 'idle'
      })
  }

  return {
    get phase() {
      return phase
    },

    isReady: () => ready,
    hasPlayer: () => Boolean(player),
    currentTime: () => (ready && player && typeof player.getCurrentTime === 'function' ? player.getCurrentTime() || 0 : 0),

    sync(state) {
      synced = state
      if (!player || !ready) return

      // a report of an ended or failed track owns the phase until it is through: a read that arrives meanwhile does
      // not end it (the player it replaced is not believed, and a second report is not sent)
      const reporting = phase === 'ending' || phase === 'failing'

      if (!state.current) {
        retries.clear()
        loadedPlayId = null
        clearWatchdog()
        player.stopVideo()
        if (!reporting) phase = 'idle'
        return
      }

      const id = state.current.videoId
      const playId = state.current.playId ?? null

      if (player.getVideoData()?.video_id !== id || playId !== loadedPlayId) {
        retries.clear()

        if (state.isPaused) {
          log(`Cueing video while paused: ${id}`)
          clearWatchdog()
          player.cueVideoById(id)
          if (!reporting) phase = 'cued'
        } else {
          log(`Loading video: ${id}`)
          player.loadVideoById(id)
          armWatchdog()
          if (!reporting) phase = 'playing'
        }

        loadedPlayId = playId
        configurePlayer()
        return
      }

      if (state.isPaused) {
        clearWatchdog()

        const playerState = player.getPlayerState()
        if (playerState === YT.PlayerState.PLAYING || playerState === YT.PlayerState.BUFFERING) {
          log('Pausing video')
          player.pauseVideo()
        }
        if (!reporting) phase = 'paused'
        return
      }

      const playerState = player.getPlayerState()
      if (playerState === YT.PlayerState.PAUSED || playerState === YT.PlayerState.CUED) {
        log('Resuming video')
        player.playVideo()
        if (playerState === YT.PlayerState.CUED) armWatchdog()
      }
      if (!reporting) phase = 'playing'
    },

    start() {
      loadYouTubeApi().then(createPlayer)
    },

    stop() {
      clearWatchdog()
    }
  }
}

// the reports of the player stop together with the overlay: a retry that is still waiting must not outlive its page.
// Aborted (not dropped) on stop, so a report that is still looping sees it and gives up
let reporting = null

// The server only listens to these two reports, so a lost one stalls the whole queue: they are retried until they get through.
// Repeating is safe: the server ignores a report about a track that is no longer the current one, and says so.
// It stops on any answer, also on a refusal that a retry cannot fix.
async function postWithRetry(url, body) {
  for (let attempt = 0; ; attempt++) {
    try {
      await request(url, { method: 'POST', body: JSON.stringify(body), signal: reporting?.signal })
      return true
    } catch (error) {
      // the overlay is gone: its reports go with it
      if (reporting?.signal.aborted) return false
      // no status: the server could not be reached
      if (error.status < 500 && error.status !== 429) {
        log(`${url} was refused with ${error.status}, not retrying`)
        return false
      }

      log(`${url} failed:`, error)
    }

    await sleep(Math.min(500 * 2 ** attempt, 15000))
  }
}

async function notifyEnded(videoId, playId) {
  await postWithRetry('/api/player/ended', { videoId, ...(playId != null ? { playId } : {}) })
  await readState()
}

async function reportFailure(errorCode, videoId, playId) {
  if (await postWithRetry('/api/player/report-failure', { errorCode, videoId, ...(playId != null ? { playId } : {}) })) {
    log(`Playback failure reported for ${videoId}`)
  }

  await readState()
}

const playback = createPlayback({
  isWanted: () => isPlaybackSource,
  reportEnded: notifyEnded,
  reportFailure,
  onReady: readState
})

function updateMediaVisibility() {
  if (!currentState?.current || currentState.isPaused) {
    dom.badge.classList.toggle('visible', false)
  } else {
    dom.badge.classList.toggle('with-video', settings.showVideo)
    dom.badge.classList.toggle('video-only', settings.showVideo && settings.hideOverlayInfo)
    dom.badge.style.opacity = `${settings.opacity}%`
    dom.badge.classList.add('visible')
  }
}

function renderCurrent() {
  if (!currentState?.current) {
    updateMediaVisibility()
    return
  }

  dom.badge.dataset.position = settings.position
  dom.currentThumbnail.src = currentState.current.thumbnail
  const track = describeTrack(currentState.current)
  dom.currentTitle.textContent = track.title
  dom.currentRequester.textContent = track.requester

  if (currentState.nextTrack) {
    const next = describeTrack(currentState.nextTrack)
    dom.nextTitle.textContent = next.title

    dom.nextElapsedTime.textContent = next.duration
    show(dom.nextPlaying)
    dom.currentTitle.classList.toggle('truncate-2line', false)
  } else {
    show(dom.nextPlaying, false)
    dom.currentTitle.classList.toggle('truncate-2line', !settings.showVideo)
  }
  updateMediaVisibility()
}

function renderState() {
  renderCurrent()

  if (currentState && (!isPlaybackSource || playback.isReady())) show(dom.badge)
  playback.sync(currentState)
}

function updateProgress() {
  if (!isPlaybackSource || !playback.hasPlayer() || !currentState?.current) return

  const currentTime = playback.currentTime()
  const duration = currentState.current.duration
  // a live stream has no length to count the progress against
  const hasLength = duration > 0

  dom.elapsedTimeCurrent.textContent = formatDuration(currentTime)

  if (currentTime > 0 || hasLength) {
    const slash = !hasLength || settings.showVideo ? '/ ' : ''
    dom.elapsedTimeEnd.textContent = `${slash}${formatTrackDuration(duration)}`

    if (hasLength) dom.progressBar.style.setProperty('--progress', `${Math.min(100, Math.floor((currentTime / duration) * 100))}%`)
    show(dom.progressBar, hasLength)
    show(dom.elapsedTimeEnd)
  } else {
    show(dom.progressBar, false)
    show(dom.elapsedTimeEnd, false)
  }
}

function enablePlayback() {
  log('This overlay plays the music')
  isPlaybackSource = true
  dom.nowPlayingVideo.classList.remove('hidden')
  show(dom.progressWrapper)
  playback.start()
}

// while the events are down the page reads the state every second, as it always did
const POLL_WHILE_EVENTS_ARE_DOWN_MS = 1000

/**
 * Starts the overlay on the page that is open. Nothing runs on import, so the overlay can be started (and stopped) by a test.
 *
 * `locks` is the Web Locks API that decides which overlay plays the music; by default the one of the browser.
 * Returns `refresh` (read the state now) and `stop` (stop reading it).
 */
export function startOverlay({ locks } = {}) {
  dom = {
    nowPlayingVideo: $('nowPlayingVideo'),
    badge: $('badge'),
    currentThumbnail: $('currentThumbnail'),
    currentTitle: $('currentTitle'),
    currentRequester: $('currentRequester'),
    progressWrapper: $('progressWrapper'),
    progressBar: $('progressBar'),
    elapsedTimeCurrent: $('elapsedTimeCurrent'),
    elapsedTimeEnd: $('elapsedTimeEnd'),
    nextPlaying: $('nextPlaying'),
    nextTitle: $('nextTitle'),
    nextElapsedTime: $('nextElapsedTime')
  }

  const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1'

  // hidden until the lock is granted: a waiting overlay must not show an empty video frame
  dom.nowPlayingVideo.classList.add('hidden')
  // the time comes from the player of this page: an overlay without one would show 0:00 for ever
  show(dom.progressWrapper, false)

  if (isLocalhost) claimPlayback(enablePlayback, locks)
  else log('Non-localhost origin: read-only widget, no embedded player')

  // the reports of this page answer to this page alone
  reporting = new AbortController()

  watcher = watch({ state: { read: fetchOverlayState } }, { safetyMs: POLL_WHILE_EVENTS_ARE_DOWN_MS })
  readState()

  // the progress bar runs on the player of this page, not on the server
  const timer = setInterval(updateProgress, 1000)

  return {
    refresh: readState,
    stop() {
      reporting?.abort()
      clearInterval(timer)
      playback.stop()
      watcher.close()
    }
  }
}
