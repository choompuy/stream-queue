import fs from 'node:fs'
import path from 'node:path'
import { getAppRoot } from './runtime.js'
import { createLogger, describeError } from './logger.js'

// resolved when used, not when the module is imported
const localesDir = (): string => path.join(getAppRoot(), 'public/locales')
const DEFAULT_LOCALE = 'en'

const log = createLogger('I18N')

type Dict = { [key: string]: Dict | string }

const cache = new Map<string, Dict>()
const reported = new Set<string>()

function loadLocale(locale: string): Dict {
  const cached = cache.get(locale)
  if (cached) return cached

  try {
    const raw = fs.readFileSync(path.join(localesDir(), `${locale}.json`), 'utf-8')
    const dict = JSON.parse(raw) as Dict
    cache.set(locale, dict)
    return dict
  } catch (error) {
    // not cached, so a later call retries; reported once, otherwise every chat reply and API error would repeat it
    if (!reported.has(locale)) {
      reported.add(locale)
      log.error(`Failed to load locale "${locale}": ${describeError(error)}`)
    }
    return {}
  }
}

// The template a key resolves to, with the default locale as the fallback: undefined when neither has it
function template(locale: string, key: string): string | undefined {
  let value: unknown = loadLocale(locale)

  for (const part of key.split('.')) {
    if (value && typeof value === 'object' && part in (value as Dict)) {
      value = (value as Dict)[part]
    } else {
      value = undefined
      break
    }
  }

  if (typeof value === 'string') return value
  return locale === DEFAULT_LOCALE ? undefined : template(DEFAULT_LOCALE, key)
}

export function t(locale: string, key: string, params: Record<string, string | number> = {}): string {
  const value = template(locale, key)
  if (value === undefined) return key // the key itself is the last resort; hasKey() tells it apart from a real text

  return Object.entries(params).reduce((acc, [param, replacement]) => acc.replaceAll(`{{${param}}}`, () => String(replacement)), value)
}

// Whether a translation exists (in the locale, or in the default one): the way to tell a missing key from
// a text that resolved, instead of comparing the result of t() with the key
export function hasKey(locale: string, key: string): boolean {
  return template(locale, key) !== undefined
}

function codeToI18nKey(code: string): string {
  const camel = code.toLowerCase().replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())
  return `api.errors.${camel}`
}

// Null for a code with no message: the caller decides what to show instead (the key itself must not reach the user)
export function translateErrorCode(locale: string, code: string, params?: Record<string, string | number>): string | null {
  const key = codeToI18nKey(code)
  if (!hasKey(locale, key)) return null
  return t(locale, key, params)
}

const reportedMissingCodes = new Set<string>()

// The text shown to the user for an API error. A code with no translation is a gap in the locales: it is logged
// (once per code, so a loop cannot fill the log) and answered with the generic failure message instead of the key
export function translateApiError(locale: string, code: string, params?: Record<string, string | number>): string {
  const localized = translateErrorCode(locale, code, params)
  if (localized !== null) return localized

  if (!reportedMissingCodes.has(code)) {
    reportedMissingCodes.add(code)
    log.warn(`No translation for error code "${code}", showing the generic failure message`)
  }
  return t(locale, 'api.errors.unexpectedError')
}
