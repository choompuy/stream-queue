import { CLOSE_ICON } from '../icons.js'
import { setClass } from '../shared.js'
import { t } from '../i18n.js'

const DEFAULT_DURATION = 4000
const MAX_TOASTS = 3

let container = null

function getContainer() {
  if (!container) container = document.getElementById('toastContainer')
  return container
}

function closeToast(toast) {
  if (!toast.isConnected || toast.classList.contains('toast-leaving')) return

  setClass(toast, 'toast-entering', false)
  setClass(toast, 'toast-leaving')

  const handleAnimationEnd = (event) => {
    if (event.animationName === 'toast-out') toast.remove()
  }

  toast.addEventListener('animationend', handleAnimationEnd)
  // animationend does not come when animations are off (reduced motion, a hidden tab): the toast is removed anyway
  setTimeout(() => toast.remove(), 1000)
}

function enforceMaxToasts(root) {
  const toasts = Array.from(root.querySelectorAll('.toast-wrapper'))

  while (toasts.length >= MAX_TOASTS) {
    const oldestToast = toasts.shift()

    if (oldestToast) closeToast(oldestToast)
  }
}

function isShowing(root, message) {
  return Array.from(root.querySelectorAll('.toast-wrapper:not(.toast-leaving) .toast-message')).some((node) => node.textContent === message)
}

export function showToast(message, options = {}) {
  const root = getContainer()
  if (!root || !message) return () => {}

  const { type = 'info', duration = DEFAULT_DURATION } = options

  if (type === 'error' && isShowing(root, message)) return () => {}

  enforceMaxToasts(root)

  const toast = document.createElement('div')
  toast.className = `toast-wrapper toast-${type} toast-entering${duration > 0 ? '' : ' toast-persistent'}`
  toast.style.setProperty('--toast-duration', `${duration > 0 ? duration : DEFAULT_DURATION}ms`)
  toast.innerHTML = `
    <div class="toast-bg"></div>
    <div class="toast">
      <span class="toast-message"></span>
      <button type="button" class="toast-close btn btn-sm btn-icon" >
        ${CLOSE_ICON(20)}
      </button>
    </div>
  `
  toast.querySelector('.toast-message').textContent = message
  const closeButton = toast.querySelector('.toast-close')
  closeButton.setAttribute('aria-label', t('common.close'))
  closeButton.addEventListener('click', () => closeToast(toast))
  root.appendChild(toast)

  if (duration > 0) setTimeout(() => closeToast(toast), duration)

  return () => closeToast(toast)
}

export const toastSuccess = (message, options) => showToast(message, { ...options, type: 'success' })
export const toastError = (message, options) => showToast(message, { ...options, type: 'error' })
export const toastInfo = (message, options) => showToast(message, { ...options, type: 'info' })
