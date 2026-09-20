import { $, formatDuration, createLogger, getErrorMessage } from './shared.js'
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

const log = createLogger('PREVIEW')

const isPlaybackSource = location.hostname === 'localhost' || location.hostname === '127.0.0.1'

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
  try {
    const response = await fetch('/api/overlay-state')
    const data = await response.json()
    settings = data.settings
    currentState = data.state
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
    dom.badge.classList.remove('visible')
  } else {
    if (settings.showVideo) {
      dom.badge.classList.add('with-video')
    } else {
      dom.badge.classList.remove('with-video')
    }
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
  dom.currentTitle.textContent = currentState.current.title
  dom.currentRequester.textContent = `@${currentState.current.requestedBy}`

  if (currentState.nextTrack) {
    dom.nextTitle.textContent = currentState.nextTrack.title
    dom.nextElapsedTime.textContent = formatDuration(Math.floor(currentState.nextTrack.duration))
    dom.nextPlaying.classList.remove('hidden')
  } else {
    dom.nextPlaying.classList.add('hidden')
  }
  updateMediaVisibility()
}

function renderState() {
  renderCurrent()

  if (currentState && (!isPlaybackSource || isPlayerReady)) dom.badge.classList.remove('hidden')
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
  if (!isPlaybackSource || !player || !currentState?.current) {
    dom.progressBar.style.width = '0%'
    dom.elapsedTime.textContent = '0:00 / 0:00'
    return
  }

  const currentTime = player.getCurrentTime() || 0
  const duration = currentState.current.duration
  const progress = duration > 0 ? ((currentTime / duration) * 100).toFixed(2) : 0
  dom.progressBar.style.width = `${progress}%`
  dom.elapsedTime.textContent = `${formatDuration(Math.floor(currentTime))} / ${formatDuration(duration)}`
}

async function notifyEnded(videoId) {
  try {
    await fetch('/api/player/ended', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ videoId })
    })
    await fetchOverlayState()
  } catch (error) {
    log('Error notifying ended:', error)
  }
}

async function reportFailure(errorCode, videoId) {
  try {
    await fetch('/api/player/report-failure', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ errorCode, videoId })
    })

    await fetchOverlayState()
    log(`Playback failure reported for ${videoId}`)
  } catch (error) {
    log('Error reporting playback failure:', error)
  }
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

  reportedFailureVideoId = videoId
  const generation = playerGeneration
  resetPlayer().then(() => {
    if (generation !== playerGeneration - 1) return

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

  if (!isPlaybackSource || typeof YT === 'undefined' || !YT.Player) return

  createPlayer()
}

if (isPlaybackSource) {
  window.onYouTubeIframeAPIReady = () => {
    log('YouTube API ready')
    createPlayer()
  }

  const tag = document.createElement('script')
  tag.src = 'https://www.youtube.com/iframe_api'
  const firstScriptTag = document.getElementsByTagName('script')[0]
  firstScriptTag.parentNode.insertBefore(tag, firstScriptTag)
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
