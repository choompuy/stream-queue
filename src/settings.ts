import { createConfigModule, rules } from './config-helper.js'
import { dataPath } from './persist.js'
import type { Settings } from './types.js'

const POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const satisfies readonly Settings['position'][]

// The one list of locales on the backend. The frontend has its own copy in public/js/i18n.js
const LOCALES = ['en', 'ru'] as const satisfies readonly Settings['locale'][]

const defaultSettings: Settings = {
  showVideo: false,
  hideOverlayInfo: false,
  opacity: 100,
  position: 'bottom-right',
  locale: 'en'
}

const settingsPath = () => dataPath('settings.json')

const settings = createConfigModule<Settings>({
  filePath: settingsPath,
  defaults: defaultSettings,
  // the overlay reads the settings through the playing state, the panel through the config topic
  topics: ['state', 'config'],
  schema: {
    showVideo: rules.boolean,
    hideOverlayInfo: rules.boolean,
    opacity: rules.integer(0, 100),
    position: rules.oneOf(POSITIONS),
    locale: rules.oneOf(LOCALES)
  }
})

export const getSettings = settings.getConfig

/** Pure validation: what is safe to apply, and the names of every field that was refused (invalid or unknown). */
export const validateSettingsUpdates = settings.validateConfigUpdates

/** Applies the valid part of `updates` and names the fields that were refused (invalid or unknown), like every save of the panel. */
export const updateSettings = settings.updateConfig
