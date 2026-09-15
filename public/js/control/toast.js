import { CHECK_ICON, ALERT_ICON, INFO_ICON, CLOSE_ICON } from '../icons.js'

const DEFAULT_DURATION = 4000
const ICON_BY_TYPE = { success: CHECK_ICON, error: ALERT_ICON, info: INFO_ICON }

let container = null

function getContainer() {
  if (!container) {
    container = document.getElementById('toastContainer')
  }
  return container
}

function closeToast(toast) {
  if (!toast.isConnected || toast.classList.contains('toast-leaving')) return
  toast.classList.add('toast-leaving')
  toast.addEventListener('animationend', () => toast.remove(), { once: true })
}

export function showToast(message, options = {}) {
  const root = getContainer()
  if (!root || !message) return () => {}

  const { type = 'info', duration = DEFAULT_DURATION } = options
  const icon = ICON_BY_TYPE[type] || ICON_BY_TYPE.info

  const toast = document.createElement('div')
  toast.className = `toast toast-${type}`
  toast.innerHTML = `
    <span class="toast-icon">${icon(18)}</span>
    <span class="toast-message"></span>
    <button type="button" class="toast-close" aria-label="Close">${CLOSE_ICON(14)}</button>
  `
  toast.querySelector('.toast-message').textContent = message
  toast.querySelector('.toast-close').addEventListener('click', () => closeToast(toast))

  root.appendChild(toast)

  if (duration > 0) {
    setTimeout(() => closeToast(toast), duration)
  }

  return () => closeToast(toast)
}

export const toastSuccess = (message, options) => showToast(message, { ...options, type: 'success' })
export const toastError = (message, options) => showToast(message, { ...options, type: 'error' })
export const toastInfo = (message, options) => showToast(message, { ...options, type: 'info' })
