import { CLOSE_ICON } from '../icons.js'
import { setClass } from '../shared.js'
import { t } from '../i18n.js'
import { dom } from './dom.js'

const DEFAULT_DURATION = 4000
const MAX_TOASTS = 3
// as long as the toast-out animation of toast.css: a timer and not the end of the animation, which does not come when animations are off
const LEAVE_MS = 200

function closeToast(toast) {
  if (!toast.isConnected || toast.classList.contains('toast-leaving')) return

  setClass(toast, 'toast-entering', false)
  setClass(toast, 'toast-leaving')
  setTimeout(() => toast.remove(), LEAVE_MS)
}

// the toasts that stay on the screen: one that is leaving is not counted
const staying = (root) => Array.from(root.querySelectorAll('.toast-wrapper:not(.toast-leaving)'))

function enforceMaxToasts(root) {
  const toasts = staying(root)

  while (toasts.length >= MAX_TOASTS) closeToast(toasts.shift())
}

function isShowing(root, message) {
  return staying(root).some((toast) => toast.querySelector('.toast-message').textContent === message)
}

function showToast(message, options = {}) {
  const root = dom.toastContainer
  if (!root || !message) return () => {}

  const { type = 'info', duration = DEFAULT_DURATION } = options

  // the same message twice at once (a button pressed again, a save that is repeated) is one message
  if (isShowing(root, message)) return () => {}

  enforceMaxToasts(root)

  const toast = document.createElement('div')
  toast.className = `toast-wrapper toast-${type} toast-entering${duration > 0 ? '' : ' toast-persistent'}`
  // an error interrupts what the screen reader is saying, the rest waits for its turn (the container is a polite live region)
  if (type === 'error') toast.setAttribute('role', 'alert')
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
