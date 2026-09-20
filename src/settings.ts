import { Settings } from './types.js'
import { notifyStateChange } from './state-events.js'

const defaultSettings: Settings = {
  showVideo: false,
  position: 'bottom-right',
  locale: 'en'
}

let currentSettings: Settings = { ...defaultSettings }

export function getSettings(): Settings {
  return { ...currentSettings }
}

export function updateSettings(updates: Partial<Settings>): Settings {
  const next = { ...currentSettings }

  if (typeof updates.showVideo === 'boolean') {
    next.showVideo = updates.showVideo
  }

  const validPositions: Settings['position'][] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
  if (typeof updates.position === 'string' && validPositions.includes(updates.position as Settings['position'])) {
    next.position = updates.position as Settings['position']
  }

  const validLocales: Settings['locale'][] = ['en', 'ru']
  if (typeof updates.locale === 'string' && validLocales.includes(updates.locale as Settings['locale'])) {
    next.locale = updates.locale as Settings['locale']
  }

  if (!next.locale) {
    next.locale = 'en'
  }

  currentSettings = next
  console.log('[SETTINGS] Updated:', currentSettings)
  notifyStateChange()
  return { ...currentSettings }
}

export function setSettings(settings: Settings): void {
  currentSettings = { ...settings }
  console.log('[SETTINGS] Set:', currentSettings)
}

export function resetSettings(): Settings {
  currentSettings = { ...defaultSettings }
  console.log('[SETTINGS] Reset to defaults')
  notifyStateChange()
  return { ...currentSettings }
}
