export const $ = (id) => document.getElementById(id)

export function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;'
      })[c]
  )
}

export function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function formatViews(views) {
  if (views >= 1000000) return `${(views / 1000000).toFixed(1)}M`
  if (views >= 1000) return `${(views / 1000).toFixed(1)}K`
  return views?.toString()
}

export function createLogger(prefix) {
  return function (...args) {
    console.log(`[${prefix}]`, ...args)
  }
}

const errorMessages = {
  2: 'player.error.invalidParameter',
  5: 'player.error.html5Error',
  100: 'player.error.videoNotFound',
  101: 'player.error.embedNotAllowed',
  150: 'player.error.embedNotAllowed'
}

export function getErrorMessage(code, t) {
  const key = errorMessages[code]
  if (key && t) {
    return t(key, { code })
  }
  if (key) {
    return key
  }
  if (t) {
    return t('player.error.errorCode', { code })
  }
  return `Error code ${code}`
}

export const ERROR_CODE_I18N_KEYS = {
  INVALID_LOCALE: 'api.errors.invalidLocale',
  INVALID_PLAYLIST_ID: 'api.errors.invalidPlaylistId',
  PLAYLIST_NOT_FOUND: 'api.errors.playlistNotFound',
  INVALID_QUERY: 'api.errors.invalidQuery',
  INVALID_REQUEST: 'api.errors.usernameRequired',
  INVALID_YOUTUBE_URL: 'api.errors.invalidYoutubeUrl',
  SONG_NOT_FOUND: 'api.errors.songNotFound',
  NOT_FOUND: 'api.errors.notFound',
  INVALID_INDEX: 'api.errors.invalidIndex',
  QUEUE_ITEM_NOT_FOUND: 'api.errors.queueItemNotFound',
  SERVER_ERROR: 'api.errors.serverError',
  DUPLICATE: 'api.errors.duplicate',
  QUEUE_FULL: 'api.errors.queueFull',
  USER_LIMIT: 'api.errors.userLimit',
  YOUTUBE_QUOTA: 'api.errors.youtubeQuota',
  YOUTUBE_ERROR: 'api.errors.youtubeError',
  NO_API_KEY: 'api.errors.noApiKey'
}

export function translateErrorCode(t, code, params, fallback = '') {
  const key = code && ERROR_CODE_I18N_KEYS[code]
  return key ? t(key, params) : fallback
}
