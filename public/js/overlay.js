import { $, formatDuration, createLogger, getErrorMessage } from './shared.js'
import { initI18n, t, getCurrentLocale } from './i18n.js'

let player = null
let currentState = null
let isPlayerReady = false
let isTransitioning = false
let settings = {}
let localeLoaded = false

const log = createLogger('PREVIEW')

const isPlaybackSource = location.hostname === 'localhost' || location.hostname === '127.0.0.1'

const dom = {
  nowPlayingVideo: $('nowPlayingVideo'),
  badgeWrapper: $('badgeWrapper'),
  badge: $('badge'),
  currentThumbnail: $('currentThumbnail'),
  currentTitle: $('currentTitle'),
  currentChannel: $('currentChannel'),
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

    const serverLocale = settings.locale || 'en'
    if (!localeLoaded || serverLocale !== getCurrentLocale()) {
      await initI18n(serverLocale)
      localeLoaded = true
    }

    renderState(data.state)
  } catch (error) {
    log('Error fetching settings:', error)
  }
}

function updateMediaVisibility(state) {
  dom.nowPlayingVideo.classList.toggle('video-collapsed', !state.showVideo)
  dom.badgeWrapper.classList.toggle('with-video', state.showVideo)
}

function renderCurrent(state) {
  if (!state.current) {
    dom.badge.classList.remove('visible')
    return
  }

  dom.badge.dataset.position = settings.position
  dom.currentThumbnail.src = state.current.thumbnail
  dom.currentTitle.textContent = state.current.title
  dom.currentRequester.textContent = `@${state.current.requestedBy}`

  if (state.nextTrack) {
    dom.nextTitle.textContent = state.nextTrack.title
    dom.nextElapsedTime.textContent = formatDuration(Math.floor(state.nextTrack.duration))
    dom.nextPlaying.classList.add('visible')
  } else {
    dom.nextPlaying.classList.remove('visible')
  }

  dom.badge.classList.add('visible')
}

function renderState(state) {
  currentState = state
  renderCurrent(state)
  updateMediaVisibility(settings)

  if (!isPlaybackSource) return

  if (isPlayerReady) {
    if (state.isPaused) {
      player.pauseVideo()
    } else if (player.getPlayerState() === YT.PlayerState.PAUSED) {
      player.playVideo()
    }
  }

  if (isPlayerReady && state.current) {
    const currentVideoId = player.getVideoData()?.video_id

    if (currentVideoId !== state.current.videoId) {
      log(`Loading video: ${state.current.videoId}`)

      player.loadVideoById(state.current.videoId)
      player.setOption('captions', 'fontSize', 0)
      player.unloadModule('captions')
    }
  } else if (isPlayerReady && !state.current && !isTransitioning) {
    player.stopVideo()
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
  const progress = ((currentTime / duration) * 100).toFixed(2)

  dom.progressBar.style.width = `${progress}%`
  dom.elapsedTime.textContent = `${formatDuration(Math.floor(currentTime))} / ${formatDuration(duration)}`
}

async function notifyEnded() {
  try {
    await fetch('/api/player/ended', { method: 'POST' })
    await fetchOverlayState()
  } catch (error) {
    log('Error notifying ended:', error)
  }
}

function onPlayerReady(event) {
  log('Player ready')
  isPlayerReady = true
  event.target.setVolume(100)
  fetchOverlayState()
}

function onPlayerStateChange(event) {
  log(`Player state: ${event.data}`)

  if (event.data === YT.PlayerState.ENDED && !isTransitioning) {
    log('Video ended, requesting next')
    isTransitioning = true
    notifyEnded().finally(() => {
      setTimeout(() => {
        isTransitioning = false
      }, 1000)
    })
  }
}

function onPlayerError(event) {
  const message = getErrorMessage(event.data, t || ((key) => key))
  log(`Player error: ${message}`)

  if (!isTransitioning) {
    isTransitioning = true

    fetch('/api/player/skip', { method: 'POST' })
      .then(() => fetchOverlayState())
      .finally(() => {
        setTimeout(() => {
          isTransitioning = false
        }, 1000)
      })
  }
}

if (isPlaybackSource) {
  window.onYouTubeIframeAPIReady = () => {
    log('YouTube API ready')
    player = new YT.Player('player', {
      width: '100%',
      height: '100%',
      playerVars: {
        autoplay: 1,
        controls: 0,
        rel: 0,
        fs: 0,
        cc_load_policy: 0,
        iv_load_policy: 3,
        disablekb: 1,
        playsinline: 1
      },
      events: {
        onReady: onPlayerReady,
        onStateChange: onPlayerStateChange,
        onError: onPlayerError
      }
    })
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
