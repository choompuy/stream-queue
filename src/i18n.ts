import fs from 'node:fs'
import path from 'node:path'
import { getAppRoot } from './runtime.js'

const LOCALES_DIR = path.join(getAppRoot(), 'public/locales')
const DEFAULT_LOCALE = 'en'

type Dict = { [key: string]: Dict | string }

const cache = new Map<string, Dict>()

function loadLocale(locale: string): Dict {
  const cached = cache.get(locale)
  if (cached) return cached

  try {
    const raw = fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), 'utf-8')
    const dict = JSON.parse(raw) as Dict
    cache.set(locale, dict)
    return dict
  } catch (error) {
    console.error(`[I18N] Failed to load locale "${locale}":`, error instanceof Error ? error.message : error)
    return {}
  }
}

export function t(locale: string, key: string, params: Record<string, string | number> = {}): string | null {
  let value: unknown = loadLocale(locale)

  for (const part of key.split('.')) {
    if (value && typeof value === 'object' && part in (value as Dict)) {
      value = (value as Dict)[part]
    } else {
      value = undefined
      break
    }
  }

  if (typeof value !== 'string') {
    if (locale !== DEFAULT_LOCALE) return t(DEFAULT_LOCALE, key, params)
    return null
  }

  return Object.entries(params).reduce((acc, [param, replacement]) => acc.replace(new RegExp(`{{${param}}}`, 'g'), () => String(replacement)), value)
}

const ERROR_CODE_KEY_OVERRIDES: Record<string, string> = {
  INVALID_REQUEST: 'api.errors.usernameRequired'
}

function codeToI18nKey(code: string): string {
  if (ERROR_CODE_KEY_OVERRIDES[code]) return ERROR_CODE_KEY_OVERRIDES[code]
  const camel = code.toLowerCase().replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())
  return `api.errors.${camel}`
}

export function translateErrorCode(locale: string, code: string, params?: Record<string, string | number>): string | null {
  const key = codeToI18nKey(code)
  return key ? t(locale, key, params) : null
}
