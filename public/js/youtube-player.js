const log = (...args) => console.log('[YouTube Player]', ...args)

let apiLoadPromise = null
let apiReady = false
let readyCallbacks = []

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

function onApiReady() {
  apiReady = true
  for (const callback of readyCallbacks) {
    callback()
  }
  readyCallbacks = []
}

export function loadYouTubeApi() {
  if (apiLoadPromise) return apiLoadPromise

  apiLoadPromise = new Promise((resolve) => {
    if (apiReady) {
      resolve()
      return
    }

    readyCallbacks.push(resolve)

    // Set up the callback if not already set
    if (!window.onYouTubeIframeAPIReady) {
      window.onYouTubeIframeAPIReady = () => {
        log('YouTube API ready')
        onApiReady()
      }
    }

    // Start loading the script
    if (document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      // Script already loading, just wait for the callback
      return
    }

    loadYouTubeApi()
  })

  return apiLoadPromise
}

export async function createYouTubePlayer(elementId, { videoId, playerVars, events }) {
  await loadYouTubeApi()

  return new Promise((resolve, reject) => {
    const player = new YT.Player(elementId, {
      videoId,
      playerVars: playerVars || {},
      events: {
        onReady: (event) => {
          log(`Player ready for ${elementId}`)
          if (events?.onReady) events.onReady(event)
          resolve(event.target)
        },
        onError: (event) => {
          log(`Player error for ${elementId}:`, event.data)
          if (events?.onError) events.onError(event)
          reject(new Error(`YouTube player error: ${event.data}`))
        },
        onStateChange: events?.onStateChange,
        onPlaybackRateChange: events?.onPlaybackRateChange,
        onPlaybackQualityChange: events?.onPlaybackQualityChange
      }
    })
  })
}

export const PLAYER_ERROR = {
  INVALID_PARAMETER: 2,
  HTML5: 5,
  NOT_FOUND: 100,
  EMBED_NOT_ALLOWED: 101
}

export function playerErrorKey(code) {
  const errorKeys = {
    [PLAYER_ERROR.INVALID_PARAMETER]: 'player.error.invalidParameter',
    [PLAYER_ERROR.HTML5]: 'player.error.html5',
    [PLAYER_ERROR.NOT_FOUND]: 'player.error.notFound',
    [PLAYER_ERROR.EMBED_NOT_ALLOWED]: 'player.error.embedNotAllowed'
  }
  return errorKeys[code] || 'player.error.unknown'
}
