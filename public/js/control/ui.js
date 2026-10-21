import { getCurrentLocale } from '../i18n.js'

const formatters = new Map()

// a formatter is made once per language: a list of rows asks for hundreds of dates
function formatter(locale, kind, options) {
  const id = `${locale}:${kind}`
  if (!formatters.has(id)) formatters.set(id, new Intl.DateTimeFormat(locale, options))
  return formatters.get(id)
}

export function formatDateTime(timestamp, joiner = ', ') {
  if (!timestamp) return '-'

  // the order of day and month (and the digits) follow the language of the panel
  const locale = getCurrentLocale()
  const time = formatter(locale, 'time', { hour: '2-digit', minute: '2-digit', hour12: false }).format(timestamp)
  const day = formatter(locale, 'day', { day: '2-digit', month: '2-digit' }).format(timestamp)

  return [time, day].join(joiner)
}
