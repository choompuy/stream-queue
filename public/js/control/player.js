import { formatDuration, formatViews, getErrorMessage } from '../shared.js'
import { PLAY_ICON, PAUSE_ICON } from '../icons.js'
import { api } from './api.js'
import { state, dom, log } from './state.js'
import { run } from './run.js'
import { setHidden } from './ui.js'
import { refreshState } from './queue.js'
import { t } from '../i18n.js'

let player = null
let playerReady = false

export function renderCurrent() {
  const current = state.current

  if (!current) {
    setHidden(dom.nowPlaying, true)
    setHidden(dom.noPlaying, false)
    return
  }

  setHidden(dom.nowPlaying, false)
  setHidden(dom.noPlaying, true)

  dom.currentTitle.textContent = current.title
  dom.currentChannel.textContent = current.channelTitle
  dom.currentDuration.textContent = formatDuration(current.duration)
  dom.currentViews.textContent = `${formatViews(current.views)} views`
  dom.currentRequester.textContent = `@${current.requestedBy}`
}

export function renderNext() {
  const next = state.nextTrack
  setHidden(dom.nextPlaying, !next)
  if (!next) return

  dom.nextTitle.textContent = next.title
  dom.nextDuration.textContent = formatDuration(next.duration)
}

export function renderPlayPause() {
  dom.playPauseBtn.title = state.isPaused ? t('nowPlaying.resume') : t('nowPlaying.pause')
  dom.playPauseBtn.innerHTML = state.isPaused ? PLAY_ICON(24) : PAUSE_ICON(24)
}

export function syncPlayer() {
  if (!playerReady || !player) return

  if (!state.current) {
    player.stopVideo()
    return
  }

  const currentVideoId = player.getVideoData()?.video_id
  if (currentVideoId === state.current.videoId) return

  log(`Loading video: ${state.current.videoId}`)
  player.cueVideoById(state.current.videoId)
}

export function playPauseCurrent() {
  return run('toggling play/pause', async () => {
    if (state.isPaused) await api.resume()
    else await api.pause()

    await refreshState()
  })
}

export function skipCurrent() {
  return run('skipping', async () => {
    await api.skip()
    await refreshState()
  })
}

export const playerActions = {
  'play-pause': playPauseCurrent,
  skip: skipCurrent
}

function onPlayerReady() {
  log('Player ready')
  playerReady = true
  syncPlayer()
}

function onPlayerError(event) {
  log(`Player error: ${getErrorMessage(event.data, t)}`)
}

window.onYouTubeIframeAPIReady = () => {
  log('YouTube API ready')

  player = new YT.Player('player', {
    width: '100%',
    height: '100%',
    playerVars: {
      autoplay: 0,
      controls: 1,
      rel: 0
    },
    events: {
      onReady: onPlayerReady,
      onError: onPlayerError
    }
  })
}

const iframeApiTag = document.createElement('script')
iframeApiTag.src = 'https://www.youtube.com/iframe_api'
document.head.appendChild(iframeApiTag)
