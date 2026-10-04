import { getCurrentLocale } from '../i18n.js'

export function withLoading(button, action) {
  if (!button) return action()

  button.disabled = true
  return Promise.resolve()
    .then(action)
    .finally(() => {
      button.disabled = false
    })
}

export function formatDateTime(timestamp, joiner = ', ') {
  if (!timestamp) return '-'

  // the order of day and month (and the digits) follow the language of the panel
  const locale = getCurrentLocale()
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(timestamp)
  const day = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' }).format(timestamp)

  return [time, day].join(joiner)
}

export function toggleActive(element, isActive) {
  if (!element) return
  if (isActive) {
    element.classList.add('active')
  } else {
    element.classList.remove('active')
  }
}
