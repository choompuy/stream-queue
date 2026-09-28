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

export function youtubeThumbnail(videoId, quality = 'mqdefault') {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/${quality}.jpg`
}

export function formatViews(views) {
  if (views == null) return '0'
  if (views >= 1000000) return `${(views / 1000000).toFixed(1)}M`
  if (views >= 1000) return `${(views / 1000).toFixed(1)}K`
  return views.toString()
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

function codeToI18nKey(code) {
  const camel = code.toLowerCase().replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())
  return `api.errors.${camel}`
}

export function translateErrorCode(t, code, params, fallback = '') {
  if (!code) return fallback

  const key = codeToI18nKey(code)
  const text = t(key, params)

  return text === key ? fallback : text
}

// UI Helper functions for DOM manipulation

/**
 * Safely add or remove a class from an element
 * @param {HTMLElement|null|undefined} element - The DOM element
 * @param {string} className - The class name to add/remove
 * @param {boolean} condition - If true, add class; if false, remove class (default: true)
 */
export function setClass(element, className, condition = true) {
  if (!element) return
  element.classList.toggle(className, condition)
}

/**
 * Show or hide an element using the 'hidden' class
 * @param {HTMLElement|null|undefined} element - The DOM element
 * @param {boolean} show - If true, remove 'hidden'; if false, add 'hidden' (default: true)
 */
export function show(element, show = true) {
  setClass(element, 'hidden', !show)
}

/**
 * Set or remove error state on an element
 * @param {HTMLElement|null|undefined} element - The DOM element
 * @param {boolean} hasError - If true, add 'error'; if false, remove 'error' (default: true)
 */
export function setError(element, hasError = true) {
  setClass(element, 'error', hasError)
}

/**
 * Show exactly one save state on a field: 'changed' (differs from stored), 'saved', 'error', or none
 * @param {HTMLElement|null|undefined} element - The input element
 * @param {'changed'|'saved'|'error'|null} state - The state to show, null to clear
 */
export function setFieldState(element, state = null) {
  for (const name of ['changed', 'saved', 'error']) setClass(element, name, name === state)
}

/**
 * Safely set value on an input element
 * @param {HTMLElement|null|undefined} element - The input element
 * @param {string|number|null} value - The value to set
 */
export function setValue(element, value) {
  if (!element) return
  element.value = value ?? ''
}

/**
 * Safely set checked state on a checkbox/radio element
 * @param {HTMLElement|null|undefined} element - The checkbox/radio element
 * @param {boolean} checked - The checked state
 */
export function setChecked(element, checked) {
  if (!element) return
  element.checked = Boolean(checked)
}

/**
 * Safely set text content on an element
 * @param {HTMLElement|null|undefined} element - The DOM element
 * @param {string} text - The text content
 */
export function setText(element, text) {
  if (!element) return
  element.textContent = text
}
