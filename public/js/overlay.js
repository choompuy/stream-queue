import { $, formatDuration, createLogger, getErrorMessage, show, setClass, setText } from './shared.js'
import { initI18n, t, getCurrentLocale } from './i18n.js'
import { loadYouTubeApi } from './youtube-api.js'
import { claimPlayback } from './playback-lock.js'
import { watch } from './sse.js'

let player = null
let currentState = null
let isPlayerReady = false
let isTransitioning = false
// set while a broken player is being replaced and its failure is reported: what the player says meanwhile is not news
let resetting = null
let settings = {}
let localeLoaded = false
// reads the state: what the server announces, and what is read while the events are down (see watch)
let watcher = null

const log = createLogger('PREVIEW')

// only one overlay on this computer plays the music: the others (and any overlay opened by another address) just show the badge
let isPlaybackSource = false

const REQUEST_TIMEOUT_MS = 8000

// The YouTube player reports error 5 for a problem of the player itself (not of the video); a retry usually fixes it
const TEMPORARY_PLAYER_ERROR = 5
const MAX_TEMPORARY_ERROR_RETRIES = 2
const temporaryErrorRetries = new Map()

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// the elements of overlay.html, found when the overlay starts
let dom = null

const readState = () => watcher.refresh('state')

async function fetchOverlayState() {
  try {
    const response = await fetch('/api/overlay-state', { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    if (!response.ok) throw new Error(`overlay-state request failed: ${response.status}`)

    const body = await response.json()
    settings = body.data.settings
    currentState = body.data.state
    const serverLocale = settings.locale || 'en'
    if (!localeLoaded || serverLocale !== getCurrentLocale()) {
      await initI18n(serverLocale)
      localeLoaded = true
    }

    renderState()
  } catch (error) {
    log('Error fetching settings:', error)
  }
}

function updateMediaVisibility() {
  if (!currentState?.current || currentState.isPaused) {
    setClass(dom.badge, 'visible', false)
  } else {
    setClass(dom.badge, 'with-video', settings.showVideo)
    setClass(dom.badge, 'video-only', settings.showVideo && settings.hideOverlayInfo)
    dom.badge.style.opacity = `${settings.opacity}%`
    setClass(dom.badge, 'visible')
  }
}

function renderCurrent() {
  if (!currentState?.current) {
    updateMediaVisibility()
    return
  }

  dom.badge.dataset.position = settings.position
  dom.currentThumbnail.src = currentState.current.thumbnail
  setText(dom.currentTitle, currentState.current.title)
  setText(dom.currentRequester, `@${currentState.current.requestedBy}`)

  if (currentState.nextTrack) {
    setText(dom.nextTitle, currentState.nextTrack.title)

    setText(dom.nextElapsedTime, formatDuration(currentState.nextTrack.duration))
    show(dom.nextPlaying)
    setClass(dom.currentTitle, 'truncate-2line', false)
  } else {
    show(dom.nextPlaying, false)
    setClass(dom.currentTitle, 'truncate-2line', !settings.showVideo)
  }
  updateMediaVisibility()
}

function renderState() {
  renderCurrent()

  if (currentState && (!isPlaybackSource || isPlayerReady)) show(dom.badge)
  if (!isPlaybackSource || !isPlayerReady || !currentState || !player) return

  if (!currentState.current) {
    temporaryErrorRetries.clear()
    player.stopVideo()
    return
  }

  const videoId = currentState.current.videoId
  const currentVideoId = player.getVideoData()?.video_id
  const playerState = player.getPlayerState()

  if (currentVideoId !== videoId) {
    temporaryErrorRetries.clear()

    if (currentState.isPaused) {
      log(`Cueing video while paused: ${videoId}`)
      player.cueVideoById(videoId)
    } else {
      log(`Loading video: ${videoId}`)
      player.loadVideoById(videoId)
    }

    configurePlayer()
    return
  }

  if (currentState.isPaused) {
    if (playerState === YT.PlayerState.PLAYING || playerState === YT.PlayerState.BUFFERING) {
      log('Pausing video')
      player.pauseVideo()
    }
    return
  }

  if (playerState === YT.PlayerState.PAUSED || playerState === YT.PlayerState.CUED) {
    log('Resuming video')
    player.playVideo()
  }
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

function updateProgress() {
  if (!isPlaybackSource || !player || !isPlayerReady || typeof player.getCurrentTime !== 'function' || !currentState?.current) {
    return
  }

  const currentTime = player.getCurrentTime() || 0
  const duration = currentState.current.duration

  setText(dom.elapsedTimeCurrent, formatDuration(currentTime, false))

  if (currentTime > 0 || duration > 0) {
    setText(dom.elapsedTimeEnd, `${duration <= 0 || settings.showVideo ? '/ ' : ''}${formatDuration(duration)}`)

    dom.progressBar.style.setProperty('--progress', `${Math.floor((currentTime / duration) * 100)}%`)
    show(dom.progressBar, duration > 0)
    show(dom.elapsedTimeEnd)
  } else {
    show(dom.progressBar, false)
    show(dom.elapsedTimeEnd, false)
  }
}

// The server only listens to these two reports, so a lost one stalls the whole queue: they are retried until they get through.
// Repeating is safe: the server ignores a report about a track that is no longer the current one, and says so.
// It stops on any answer, also on a refusal that a retry cannot fix.
async function postWithRetry(url, body) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })

      if (response.ok) return true

      if (response.status < 500 && response.status !== 429) {
        log(`${url} was refused with ${response.status}, not retrying`)
        return false
      }

      log(`${url} failed with ${response.status}`)
    } catch (error) {
      log(`${url} failed:`, error)
    }

    await sleep(Math.min(500 * 2 ** Math.min(attempt, 6), 15000))
  }
}

async function notifyEnded(videoId) {
  await postWithRetry('/api/player/ended', { videoId })
  await readState()
}

async function reportFailure(errorCode, videoId) {
  if (await postWithRetry('/api/player/report-failure', { errorCode, videoId })) {
    log(`Playback failure reported for ${videoId}`)
  }

  await readState()
}

// Returns true when a retry has been scheduled, so the failure is not reported yet
function retryTemporaryError(errorCode, videoId, retried) {
  if (errorCode !== TEMPORARY_PLAYER_ERROR) return false

  const retries = temporaryErrorRetries.get(videoId) ?? 0
  if (retries >= MAX_TEMPORARY_ERROR_RETRIES) return false

  temporaryErrorRetries.set(videoId, retries + 1)
  log(`Temporary player error, retry ${retries + 1}/${MAX_TEMPORARY_ERROR_RETRIES} for ${videoId}`)

  // taken now, while the player still knows where it was: the retry continues from there instead of from the start
  const startSeconds = Math.max(0, Math.floor(Number(player?.getCurrentTime?.()) || 0))

  setTimeout(
    () => {
      const stillCurrent = player === retried && currentState?.current?.videoId === videoId
      if (!stillCurrent) return

      if (currentState.isPaused) player.cueVideoById({ videoId, startSeconds })
      else player.loadVideoById({ videoId, startSeconds })
    },
    2000 * (retries + 1)
  )

  return true
}

function onPlayerReady(event) {
  log('Player ready')
  isPlayerReady = true
  event.target.setVolume(100)
  configurePlayer()
  readState()
}

function onPlayerStateChange(event) {
  log(`Player state: ${event.data}`)

  if (event.data === YT.PlayerState.ENDED && !isTransitioning) {
    log('Video ended, requesting next')
    isTransitioning = true
    // the track that actually finished in the player, which may differ from what the server considers current now
    const endedVideoId = event.target.getVideoData?.().video_id || currentState?.current?.videoId
    notifyEnded(endedVideoId).finally(() => {
      isTransitioning = false
    })
  }
}

function onPlayerError(event) {
  const message = getErrorMessage(event.data, t)
  log(`Player error: ${message}`)
  const videoId = currentState?.current?.videoId

  if (!videoId) {
    log('Player error without current video')
    return
  }

  if (resetting) {
    log('Ignoring a player error while the player is being replaced')
    return
  }

  if (retryTemporaryError(event.data, videoId, event.target)) return

  resetting = resetPlayer()
    .then(() => reportFailure(event.data, videoId))
    .finally(() => {
      resetting = null
    })
}

function createPlayer() {
  if (!isPlaybackSource || typeof YT === 'undefined' || !YT.Player) return

  // the events of a player that was replaced come from an object that is not `player` any more, and are left alone
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
        if (event.target === player) onPlayerReady(event)
      },

      onStateChange: (event) => {
        if (event.target === player) onPlayerStateChange(event)
      },

      onError: (event) => {
        if (event.target === player) onPlayerError(event)
      }
    }
  })

  log('YouTube player created')
}

async function resetPlayer() {
  const oldPlayer = player

  player = null
  isPlayerReady = false

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

function enablePlayback() {
  log('This overlay plays the music')
  isPlaybackSource = true
  dom.nowPlayingVideo.classList.remove('hidden')
  loadYouTubeApi().then(createPlayer)
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

  if (isLocalhost) claimPlayback(enablePlayback, locks)
  else log('Non-localhost origin: read-only widget, no embedded player')

  watcher = watch({ state: { read: fetchOverlayState } }, { safetyMs: POLL_WHILE_EVENTS_ARE_DOWN_MS })
  readState()

  // the progress bar runs on the player of this page, not on the server
  const timer = setInterval(updateProgress, 1000)

  return {
    refresh: readState,
    stop() {
      clearInterval(timer)
      watcher.close()
    }
  }
}
