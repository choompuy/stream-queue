import { formatDuration, formatViews, getErrorMessage, show, setText } from '../shared.js'
import { PLAY_ICON, PAUSE_ICON } from '../icons.js'
import { state } from './state.js'
import { dom } from './dom.js'
import { log } from './log.js'
import { t, getCurrentLocale } from '../i18n.js'
import { loadYouTubeApi } from '../youtube-api.js'

let player = null
let playerReady = false

export function renderCurrent() {
  const current = state.current

  if (!current) {
    show(dom.nowPlaying, false)
    show(dom.noPlaying)
    return
  }

  show(dom.nowPlaying)
  show(dom.noPlaying, false)

  setText(dom.currentTitle, current.title)
  setText(dom.currentChannel, current.channelTitle)
  setText(dom.currentDuration, formatDuration(current.duration))
  setText(dom.currentViews, t('player.views', { count: formatViews(current.views, getCurrentLocale()) }))
  setText(dom.currentRequester, `@${current.requestedBy}`)
}

export function renderNext() {
  const next = state.nextTrack
  show(dom.nextPlaying, !!next)
  if (!next) return

  setText(dom.nextTitle, next.title)
  setText(dom.nextDuration, formatDuration(next.duration))
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

function onPlayerReady() {
  log('Player ready')
  playerReady = true
  syncPlayer()
}

function onPlayerError(event) {
  log(`Player error: ${getErrorMessage(event.data, t)}`)
}

loadYouTubeApi().then(() => {
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
})
