import { $, formatDuration, createLogger, getErrorMessage, show, setClass, setText } from './shared.js'
import { initI18n, t, getCurrentLocale } from './i18n.js'

let player = null
let currentState = null
let isPlayerReady = false
let isTransitioning = false
let reportedFailureVideoId = null
let renderedVideoId = null
let settings = {}
let localeLoaded = false
let playerGeneration = 0
let resetCounter = 0

const log = createLogger('PREVIEW')

const isPlaybackSource = location.hostname === 'localhost' || location.hostname === '127.0.0.1'

const REQUEST_TIMEOUT_MS = 8000
const STALE_POLL_MS = 15000
let fetchStartedAt = 0

// The YouTube player reports error 5 for a problem of the player itself (not of the video); a retry usually fixes it
const TEMPORARY_PLAYER_ERROR = 5
const MAX_TEMPORARY_ERROR_RETRIES = 2
const temporaryErrorRetries = new Map()

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const dom = {
  nowPlayingVideo: $('nowPlayingVideo'),
  badge: $('badge'),
  currentThumbnail: $('currentThumbnail'),
  currentTitle: $('currentTitle'),
  currentRequester: $('currentRequester'),
  progressBar: $('progressBar'),
  elapsedTime: $('elapsedTime'),
  nextPlaying: $('nextPlaying'),
  nextTitle: $('nextTitle'),
  nextElapsedTime: $('nextElapsedTime')
}

async function fetchOverlayState() {
  if (fetchStartedAt && Date.now() - fetchStartedAt < STALE_POLL_MS) return
  const startedAt = Date.now()
  fetchStartedAt = startedAt

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
  } finally {
    if (fetchStartedAt === startedAt) fetchStartedAt = 0
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
    setText(dom.nextElapsedTime, formatDuration(Math.floor(currentState.nextTrack.duration)))
    show(dom.nextPlaying)
  } else {
    show(dom.nextPlaying, false)
  }
  updateMediaVisibility()
}

function renderState() {
  renderCurrent()

  if (currentState && (!isPlaybackSource || isPlayerReady)) show(dom.badge)
  if (!isPlaybackSource || !isPlayerReady || !currentState || !player) return

  if (!currentState.current) {
    renderedVideoId = null
    reportedFailureVideoId = null

    if (!isTransitioning) {
      player.stopVideo()
    }

    return
  }

  const videoId = currentState.current.videoId
  if (renderedVideoId !== videoId) {
    renderedVideoId = videoId
    reportedFailureVideoId = null
    temporaryErrorRetries.clear()
  }

  const currentVideoId = player.getVideoData()?.video_id
  const playerState = player.getPlayerState()

  if (currentVideoId !== videoId) {
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
    dom.progressBar.style.width = '0%'
    setText(dom.elapsedTime, '0:00 / 0:00')
    return
  }

  const currentTime = player.getCurrentTime() || 0
  const duration = currentState.current.duration
  const progress = duration > 0 ? ((currentTime / duration) * 100).toFixed(2) : 0
  dom.progressBar.style.width = `${progress}%`
  setText(dom.elapsedTime, `${formatDuration(Math.floor(currentTime))} / ${formatDuration(duration)}`)
}

// The server only listens to these two reports, so a lost one stalls the whole queue: they are retried until they get through.
// Repeating is safe, the server ignores a report about a track that is no longer the current one.
// It stops early when the server is seen to have moved on to another track, and on a refusal that a retry cannot fix.
async function postWithRetry(url, body, videoId) {
  const movedOn = () => currentState?.current?.videoId !== videoId

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

    if (movedOn()) return false

    await sleep(Math.min(500 * 2 ** Math.min(attempt, 6), 15000))
    if (movedOn()) return false
  }
}

async function notifyEnded(videoId) {
  await postWithRetry('/api/player/ended', { videoId }, videoId)
  await fetchOverlayState()
}

async function reportFailure(errorCode, videoId) {
  if (await postWithRetry('/api/player/report-failure', { errorCode, videoId }, videoId)) {
    log(`Playback failure reported for ${videoId}`)
  }

  await fetchOverlayState()
}

// Returns true when a retry has been scheduled, so the failure is not reported yet
function retryTemporaryError(errorCode, videoId, generation) {
  if (errorCode !== TEMPORARY_PLAYER_ERROR) return false

  const retries = temporaryErrorRetries.get(videoId) ?? 0
  if (retries >= MAX_TEMPORARY_ERROR_RETRIES) return false

  temporaryErrorRetries.set(videoId, retries + 1)
  log(`Temporary player error, retry ${retries + 1}/${MAX_TEMPORARY_ERROR_RETRIES} for ${videoId}`)

  setTimeout(
    () => {
      const stillCurrent = generation === playerGeneration && player && currentState?.current?.videoId === videoId
      if (!stillCurrent) return

      if (currentState.isPaused) player.cueVideoById(videoId)
      else player.loadVideoById(videoId)
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
  fetchOverlayState()
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
  const message = getErrorMessage(event.data, t || ((key) => key))
  log(`Player error: ${message}`)
  const videoId = currentState?.current?.videoId

  if (!videoId) {
    log('Player error without current video')
    return
  }

  if (reportedFailureVideoId === videoId) {
    log(`Ignoring duplicate error for video: ${videoId}`)
    return
  }

  if (retryTemporaryError(event.data, videoId, playerGeneration)) return

  reportedFailureVideoId = videoId
  resetPlayer().then((token) => {
    if (token !== resetCounter) return

    reportFailure(event.data, videoId)
  })
}

function createPlayer() {
  if (!isPlaybackSource || typeof YT === 'undefined' || !YT.Player) return

  playerGeneration += 1
  const generation = playerGeneration
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
        if (generation !== playerGeneration) return
        onPlayerReady(event)
      },

      onStateChange: (event) => {
        if (generation !== playerGeneration) return
        onPlayerStateChange(event)
      },

      onError: (event) => {
        if (generation !== playerGeneration) return
        onPlayerError(event)
      }
    }
  })

  log(`YouTube player created: generation ${generation}`)
}

async function resetPlayer() {
  const token = ++resetCounter
  const oldPlayer = player

  player = null
  isPlayerReady = false
  renderedVideoId = null

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

  await new Promise((resolve) => requestAnimationFrame(resolve))

  if (!isPlaybackSource || typeof YT === 'undefined' || !YT.Player) return token

  createPlayer()
  return token
}

// OBS often starts before the network is up: a failed load of the API script is retried, with growing pauses, until it works
function loadYouTubeApi(attempt = 0) {
  const tag = document.createElement('script')
  tag.src = 'https://www.youtube.com/iframe_api'

  tag.onerror = () => {
    tag.remove()
    const delay = Math.min(2000 * 2 ** Math.min(attempt, 5), 30000)
    log(`YouTube API failed to load, retrying in ${delay / 1000}s`)
    setTimeout(() => loadYouTubeApi(attempt + 1), delay)
  }

  const firstScriptTag = document.getElementsByTagName('script')[0]
  firstScriptTag.parentNode.insertBefore(tag, firstScriptTag)
}

if (isPlaybackSource) {
  window.onYouTubeIframeAPIReady = () => {
    log('YouTube API ready')
    createPlayer()
  }

  loadYouTubeApi()
} else {
  log('Non-localhost origin: read-only widget, no embedded player')
  dom.nowPlayingVideo.classList.add('hidden')
}

async function init() {
  await fetchOverlayState()
}

init()

setInterval(() => {
  fetchOverlayState()
  updateProgress()
}, 1000)
