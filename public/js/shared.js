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

const ERROR_CODE_KEY_OVERRIDES = {
  INVALID_REQUEST: 'api.errors.usernameRequired'
}

function codeToI18nKey(code) {
  if (ERROR_CODE_KEY_OVERRIDES[code]) return ERROR_CODE_KEY_OVERRIDES[code]
  const camel = code.toLowerCase().replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())
  return `api.errors.${camel}`
}

export function translateErrorCode(t, code, params, fallback = '') {
  const key = code && codeToI18nKey(code)
  return key ? t(key, params) : fallback
}
