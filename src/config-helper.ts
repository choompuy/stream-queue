import { createFileStore, deepMerge, type DeepPartial } from './persist.js'

export type FieldRule = {
  normalize?: (value: unknown) => unknown
  validate: (value: unknown) => boolean
}

// A tree: a FieldRule is a field, any other object is a nested group of fields
export type Schema = { [key: string]: FieldRule | Schema }

export const rules = {
  boolean: { validate: (v) => typeof v === 'boolean' } as FieldRule,
  number: (min: number, max = Infinity): FieldRule => ({ validate: (v) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max })
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isRule = (entry: FieldRule | Schema): entry is FieldRule => typeof entry.validate === 'function'

function validateSchema(schema: Schema, raw: unknown, path: string, rejected: string[]): Record<string, unknown> | undefined {
  if (!isPlainObject(raw)) {
    rejected.push(path || 'body')
    return undefined
  }

  const clean: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(raw)) {
    const entry = Object.hasOwn(schema, key) ? schema[key] : undefined
    const at = path ? `${path}.${key}` : key

    if (!entry) {
      rejected.push(at)
    } else if (isRule(entry)) {
      const normalized = entry.normalize ? entry.normalize(value) : value
      if (entry.validate(normalized)) clean[key] = normalized
      else rejected.push(at)
    } else {
      const nested = validateSchema(entry, value, at, rejected)
      if (nested) clean[key] = nested
    }
  }

  return clean
}

export function createConfigModule<T extends object>(options: {
  filePath: string
  defaults: T
  schema: Schema
  refine?: (clean: DeepPartial<T>, current: T, reject: (path: string) => void) => void
}) {
  const { filePath, defaults, schema, refine } = options
  const store = createFileStore<T>(filePath)
  let config: T = store.load(defaults)

  const save = () =>
    store.scheduleSave(
      () => config,
      (error) => console.error(`[CONFIG ${filePath}] Failed to save config:`, error instanceof Error ? error.message : error)
    )

  function validateConfigUpdates(updates: unknown, current: T = config) {
    const rejected: string[] = []
    const clean = (validateSchema(schema, updates, '', rejected) ?? {}) as DeepPartial<T>
    refine?.(clean, current, (path) => rejected.push(path))
    return { clean, rejected }
  }

  function updateConfig(updates: DeepPartial<T>) {
    const { clean, rejected } = validateConfigUpdates(updates)
    config = deepMerge(config, clean)
    save()
    return { config: structuredClone(config), rejected }
  }

  function restoreConfig(snapshot: T): void {
    config = structuredClone(snapshot)
    save()
  }

  return { getConfig: (): T => structuredClone(config), validateConfigUpdates, updateConfig, restoreConfig }
}
