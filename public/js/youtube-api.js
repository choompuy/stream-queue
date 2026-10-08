import { createLogger } from './shared.js'

const log = createLogger('YOUTUBE API')

const API_URL = 'https://www.youtube.com/iframe_api'

let ready = null

// OBS often starts before the network is up: a failed load of the API script is tried again, with growing pauses, until it works
function addScript(attempt) {
  const tag = document.createElement('script')
  tag.src = API_URL

  tag.onerror = () => {
    tag.remove()
    const delay = Math.min(2000 * 2 ** Math.min(attempt, 5), 30000)
    log(`API failed to load, retrying in ${delay / 1000}s`)
    setTimeout(() => addScript(attempt + 1), delay)
  }

  document.head.appendChild(tag)
}

// Resolves with `YT` once the IFrame API can create players. Every caller gets the same promise, so the script is added once.
export function loadYouTubeApi() {
  if (ready) return ready

  ready = new Promise((resolve) => {
    if (window.YT?.Player) {
      resolve(window.YT)
      return
    }

    window.onYouTubeIframeAPIReady = () => {
      log('API ready')
      resolve(window.YT)
    }

    addScript(0)
  })

  return ready
}
