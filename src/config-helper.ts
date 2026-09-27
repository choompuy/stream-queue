import { createFileStore } from './persist.js'

export type FieldRule<T = unknown> = {
  normalize?: (value: unknown) => unknown
  validate: (value: unknown) => boolean
}

export type ConfigValidation<T> = {
  clean: Partial<T>
  rejected: string[]
}

export type ConfigUpdateResult<T> = {
  config: T
  rejected: string[]
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function createConfigModule<T extends Record<string, unknown>>(options: {
  filePath: string
  defaults: T
  rules: Record<keyof T, FieldRule<T>>
  clone?: (source: T) => T
}) {
  const { filePath, defaults, rules, clone } = options
  const store = createFileStore<T>(filePath)
  let config: T = store.load(defaults)

  function cloneConfig(source: T): T {
    if (clone) return clone(source)
    // Deep clone using JSON for configs
    return JSON.parse(JSON.stringify(source)) as T
  }

  function saveConfig(): void {
    store.scheduleSave(
      () => config,
      (error) => console.error(`[CONFIG ${filePath}] Failed to save config:`, error instanceof Error ? error.message : error)
    )
  }

  function getConfig(): T {
    return cloneConfig(config)
  }

  function validateConfigUpdates(updates: unknown, current: T = config): ConfigValidation<T> {
    const clean: Record<string, unknown> = {}
    const rejected: string[] = []

    if (!isPlainObject(updates)) return { clean: {}, rejected: ['body'] }

    for (const [key, raw] of Object.entries(updates)) {
      const rule = Object.hasOwn(rules, key) ? rules[key as keyof T] : undefined
      if (!rule) {
        rejected.push(key)
        continue
      }

      const value = rule.normalize ? rule.normalize(raw) : raw
      if (rule.validate(value)) clean[key] = value
      else rejected.push(key)
    }

    return {
      clean: clean as Partial<T>,
      rejected
    }
  }

  function updateConfig(updates: Partial<T>): ConfigUpdateResult<T> {
    const { clean, rejected } = validateConfigUpdates(updates, config)

    config = {
      ...config,
      ...clean
    }
    saveConfig()

    return {
      config: cloneConfig(config),
      rejected
    }
  }

  function restoreConfig(snapshot: T): void {
    config = cloneConfig(snapshot)
    saveConfig()
  }

  return {
    getConfig,
    updateConfig,
    validateConfigUpdates,
    restoreConfig
  }
}
