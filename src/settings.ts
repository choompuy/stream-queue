import { Settings } from './types.js'
import { notifyStateChange } from './state-events.js'
import { createLogger } from './logger.js'

const defaultSettings: Settings = {
  showVideo: false,
  position: 'bottom-right',
  locale: 'en'
}

let currentSettings: Settings = { ...defaultSettings }

const log = createLogger('SETTINGS')

export function getSettings(): Settings {
  return { ...currentSettings }
}

const POSITIONS: Settings['position'][] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
const LOCALES: Settings['locale'][] = ['en', 'ru']

const SETTINGS_RULES: Record<keyof Settings, (value: unknown) => boolean> = {
  showVideo: (v) => typeof v === 'boolean',
  position: (v) => POSITIONS.includes(v as Settings['position']),
  locale: (v) => LOCALES.includes(v as Settings['locale'])
}

export type SettingsValidation = { clean: Partial<Settings>; rejected: string[] }

/** Pure validation: what is safe to apply, and the names of every field that was refused (invalid or unknown). */
export function validateSettingsUpdates(updates: unknown): SettingsValidation {
  if (typeof updates !== 'object' || updates === null || Array.isArray(updates)) return { clean: {}, rejected: ['body'] }

  const clean: Record<string, unknown> = {}
  const rejected: string[] = []

  for (const [key, value] of Object.entries(updates)) {
    const rule = Object.hasOwn(SETTINGS_RULES, key) ? SETTINGS_RULES[key as keyof Settings] : undefined

    if (rule?.(value)) clean[key] = value
    else rejected.push(key)
  }

  return { clean: clean as Partial<Settings>, rejected }
}

/** Applies the valid part of `updates`; the HTTP layer uses validateSettingsUpdates() to refuse the rest. */
export function updateSettings(updates: Partial<Settings>): Settings {
  const { clean } = validateSettingsUpdates(updates)
  const next: Settings = { ...currentSettings, ...clean }

  if (!next.locale) {
    next.locale = 'en'
  }

  currentSettings = next
  log.log(`Updated: ${currentSettings}`)
  notifyStateChange()
  return { ...currentSettings }
}

export function setSettings(settings: Settings): void {
  currentSettings = { ...settings }
  log.log(`Set: ${currentSettings}`)
}

export function resetSettings(): Settings {
  currentSettings = { ...defaultSettings }
  log.log('Reset to defaults')
  notifyStateChange()
  return { ...currentSettings }
}
