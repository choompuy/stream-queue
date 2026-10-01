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

  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')

  return [`${hours}:${minutes}`, `${day}/${month}`].join(joiner)
}

export function toggleActive(element, isActive) {
  if (!element) return
  if (isActive) {
    element.classList.add('active')
  } else {
    element.classList.remove('active')
  }
}
