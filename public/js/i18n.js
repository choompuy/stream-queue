const DEFAULT_LOCALE = 'ru'
const SUPPORTED_LOCALES = ['ru', 'en']
const STORAGE_KEY = 'app-locale'

let currentLocale = DEFAULT_LOCALE
let translations = {}

const pluralRules = {
  ru: (n) => {
    const lastTwo = n % 100
    const lastOne = n % 10
    if (lastTwo >= 11 && lastTwo <= 19) return 'many'
    if (lastOne === 1) return 'one'
    if (lastOne >= 2 && lastOne <= 4) return 'few'
    return 'many'
  },
  en: (n) => {
    return n === 1 ? 'one' : 'many'
  }
}

export async function loadTranslations(locale) {
  if (!SUPPORTED_LOCALES.includes(locale)) {
    locale = DEFAULT_LOCALE
  }

  try {
    const response = await fetch(`/locales/${locale}.json`)
    translations = await response.json()
    currentLocale = locale
    return true
  } catch (error) {
    console.error(`Failed to load translations for ${locale}:`, error)
    if (locale !== DEFAULT_LOCALE) {
      return loadTranslations(DEFAULT_LOCALE)
    }
    return false
  }
}

export function t(key, params = {}) {
  const keys = key.split('.')
  let value = translations

  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = value[k]
    } else {
      return key
    }
  }

  if (typeof value !== 'string') {
    return key
  }

  let result = value

  for (const [param, replacement] of Object.entries(params)) {
    result = result.replace(new RegExp(`{{${param}}}`, 'g'), replacement)
  }

  return result
}

export function tPlural(key, count, params = {}) {
  const rule = pluralRules[currentLocale] || pluralRules.en
  const form = rule(Number(count))
  const pluralKey = `${key}.${form}`
  return t(pluralKey, { ...params, count })
}

export function getCurrentLocale() {
  return currentLocale
}

export function setLocale(locale) {
  if (SUPPORTED_LOCALES.includes(locale)) {
    localStorage.setItem(STORAGE_KEY, locale)
    return loadTranslations(locale)
  }
  return Promise.resolve(false)
}

export function getSavedLocale() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && SUPPORTED_LOCALES.includes(saved)) {
      return saved
    }
  } catch {
    // localStorage might not be available
  }
  return DEFAULT_LOCALE
}

export function getSupportedLocales() {
  return SUPPORTED_LOCALES
}

export function getLocaleName(locale) {
  const names = {
    ru: 'Русский',
    en: 'English'
  }
  return names[locale] || locale
}

export async function initI18n() {
  const savedLocale = getSavedLocale()
  await loadTranslations(savedLocale)
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

  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title')
    if (key) {
      el.title = t(key)
    }
  })
}
