import { CLOSE_ICON } from '../icons.js'

const DEFAULT_DURATION = 4000
const MAX_TOASTS = 3

let container = null

function getContainer() {
  if (!container) container = document.getElementById('toastContainer')
  return container
}

function closeToast(toast) {
  if (!toast.isConnected || toast.classList.contains('toast-leaving')) return

  toast.classList.remove('toast-entering')
  toast.classList.add('toast-leaving')

  const handleAnimationEnd = (event) => {
    if (event.animationName === 'toast-out') toast.remove()
  }

  toast.addEventListener('animationend', handleAnimationEnd)
}

function enforceMaxToasts(root) {
  const toasts = Array.from(root.querySelectorAll('.toast-wrapper'))

  while (toasts.length >= MAX_TOASTS) {
    const oldestToast = toasts.shift()

    if (oldestToast) closeToast(oldestToast)
  }
}

export function showToast(message, options = {}) {
  const root = getContainer()
  if (!root || !message) return () => {}

  const { type = 'info', duration = DEFAULT_DURATION } = options
  enforceMaxToasts(root)

  const toast = document.createElement('div')
  toast.className = `toast-wrapper toast-${type} toast-entering`
  toast.innerHTML = `
    <div class="toast-bg"></div>
    <div class="toast">
      <span class="toast-message"></span>
      <button type="button" class="toast-close btn btn-sm btn-icon" aria-label="Close">
        ${CLOSE_ICON(20)}
      </button>
    </div>
  `
  toast.querySelector('.toast-message').textContent = message
  toast.querySelector('.toast-close').addEventListener('click', () => closeToast(toast))
  root.appendChild(toast)

  if (duration > 0) setTimeout(() => closeToast(toast), duration)

  return () => closeToast(toast)
}

export const toastSuccess = (message, options) => showToast(message, { ...options, type: 'success' })
export const toastError = (message, options) => showToast(message, { ...options, type: 'error' })
export const toastInfo = (message, options) => showToast(message, { ...options, type: 'info' })
