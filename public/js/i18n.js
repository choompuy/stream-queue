const DEFAULT_LOCALE = 'en'

let currentLocale = DEFAULT_LOCALE
let translations = {}
// the default language, loaded next to another one: a key missing there shows English text instead of the key itself
let fallbackTranslations = {}

export async function loadTranslations(locale) {
  try {
    const response = await fetch(`/locales/${locale}.json`)
    translations = await response.json()
    currentLocale = locale
    fallbackTranslations = locale === DEFAULT_LOCALE ? {} : await loadFallback()
    return true
  } catch (error) {
    console.error(`Failed to load translations for ${locale}:`, error)
    if (locale !== DEFAULT_LOCALE) {
      return loadTranslations(DEFAULT_LOCALE)
    }
    return false
  }
}

async function loadFallback() {
  try {
    const response = await fetch(`/locales/${DEFAULT_LOCALE}.json`)
    return await response.json()
  } catch {
    return {}
  }
}

function lookup(dictionary, keys) {
  let value = dictionary

  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) value = value[k]
    else return undefined
  }

  return typeof value === 'string' ? value : undefined
}

export function t(key, params = {}) {
  const keys = key.split('.')
  const value = lookup(translations, keys) ?? lookup(fallbackTranslations, keys)

  if (value === undefined) return key

  let result = value

  for (const [param, replacement] of Object.entries(params)) {
    result = result.replaceAll(`{{${param}}}`, () => String(replacement))
  }

  return result
}

export function getCurrentLocale() {
  return currentLocale
}

export async function initI18n(locale = DEFAULT_LOCALE) {
  await loadTranslations(locale)
  document.documentElement.lang = currentLocale
  updateDomTranslations()
  return currentLocale
}

export function updateDomTranslations() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n')
    if (key) {
      el.textContent = t(key)
    }
  })

  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder')
    if (key) {
      el.placeholder = t(key)
    }
  })

  document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    const key = el.getAttribute('data-i18n-aria-label')
    if (key) el.setAttribute('aria-label', t(key))
  })

  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title')
    if (key) {
      el.title = t(key)
    }
  })
}
