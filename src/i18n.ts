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

const ERROR_CODE_KEYS: Record<string, string> = {
  INVALID_LOCALE: 'api.errors.invalidLocale',
  INVALID_PLAYLIST_ID: 'api.errors.invalidPlaylistId',
  PLAYLIST_NOT_FOUND: 'api.errors.playlistNotFound',
  INVALID_QUERY: 'api.errors.invalidQuery',
  INVALID_REQUEST: 'api.errors.usernameRequired',
  INVALID_YOUTUBE_URL: 'api.errors.invalidYoutubeUrl',
  SONG_NOT_FOUND: 'api.errors.songNotFound',
  NOT_FOUND: 'api.errors.notFound',
  INVALID_INDEX: 'api.errors.invalidIndex',
  QUEUE_ITEM_NOT_FOUND: 'api.errors.queueItemNotFound',
  SERVER_ERROR: 'api.errors.serverError',
  DUPLICATE: 'api.errors.duplicate',
  BLOCKED: 'api.errors.blocked',
  QUEUE_FULL: 'api.errors.queueFull',
  USER_LIMIT: 'api.errors.userLimit',
  YOUTUBE_QUOTA: 'api.errors.youtubeQuota',
  YOUTUBE_ERROR: 'api.errors.youtubeError',
  NO_API_KEY: 'api.errors.noApiKey'
}

export function translateErrorCode(locale: string, code: string, params?: Record<string, string | number>): string | null {
  const key = ERROR_CODE_KEYS[code]
  return key ? t(locale, key, params) : null
}
