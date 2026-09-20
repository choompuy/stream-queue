import { t } from '../i18n.js'

export function withLoading(button, action) {
  if (!button) return action()

  button.disabled = true
  return Promise.resolve()
    .then(action)
    .finally(() => {
      button.disabled = false
    })
}

export function setHidden(element, hidden) {
  element?.classList.toggle('hidden', hidden)
}

export function toggleActive(element, active) {
  element?.classList.toggle('active', Boolean(active))
}

export function formatRelativeTime(timestamp) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 60) return t('time.secondsAgo', { count: seconds })

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return t('time.minutesAgo', { count: minutes })

  const hours = Math.floor(minutes / 60)
  return t('time.hoursAgo', { count: hours })
}

export function formatDateTime(timestamp) {
  if (!timestamp) return '-'

  const locale = document.documentElement.lang || 'en'
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(timestamp))
}
