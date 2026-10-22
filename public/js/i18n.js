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

  // one pass: a value that itself contains "{{other}}" (a track title is typed by a viewer) is not looked into again
  return value.replace(/\{\{(\w+)\}\}/g, (placeholder, name) => (name in params ? String(params[name]) : placeholder))
}

export function getCurrentLocale() {
  return currentLocale
}

export function requesterName(item) {
  return item?.isFallback ? t('fallback.requester') : item?.requestedBy ? `@${item.requestedBy}` : ''
}

export async function initI18n(locale = DEFAULT_LOCALE) {
  await loadTranslations(locale)
  document.documentElement.lang = currentLocale
  updateDomTranslations()
  return currentLocale
}

// how a key on an element becomes text: data-i18n is the text itself, the others name the attribute they fill
const I18N_ATTRIBUTES = {
  'data-i18n': 'textContent',
  'data-i18n-placeholder': 'placeholder',
  'data-i18n-aria-label': 'aria-label',
  'data-i18n-title': 'title'
}

export function updateDomTranslations() {
  for (const [attribute, target] of Object.entries(I18N_ATTRIBUTES)) {
    document.querySelectorAll(`[${attribute}]`).forEach((element) => {
      const key = element.getAttribute(attribute)
      if (!key) return

      if (target === 'textContent') element.textContent = t(key)
      else element.setAttribute(target, t(key))
    })
  }
}
