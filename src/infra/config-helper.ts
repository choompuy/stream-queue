import { createFileStore, deepMerge, type DeepPartial } from './persist.js'
import { createLogger, describeError } from './logger.js'

const FIELD = Symbol('field-rule')

export type FieldRule = {
  [FIELD]: true
  normalize?: (value: unknown) => unknown
  validate: (value: unknown) => boolean
}

// A tree: a FieldRule is a field, any other object is a nested group of fields
export type Schema = { [key: string]: FieldRule | Schema }

// The only way to make a field: the marker is what tells a field apart from a group that happens to have a `validate` key
export const field = (rule: { normalize?: (value: unknown) => unknown; validate: (value: unknown) => boolean }): FieldRule => ({
  ...rule,
  [FIELD]: true
})

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export const rules = {
  boolean: field({ validate: (v) => typeof v === 'boolean' }),
  number: (min: number, max = Infinity): FieldRule => field({ validate: (v) => isNumber(v) && v >= min && v <= max }),
  integer: (min: number, max = Infinity): FieldRule =>
    field({ validate: (v) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max }),
  oneOf: (values: readonly unknown[]): FieldRule => field({ validate: (v) => values.includes(v) })
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isRule = (entry: FieldRule | Schema): entry is FieldRule => FIELD in entry

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

// Pure validation against a schema: what is safe to apply, and the path of every refused field (invalid or unknown)
export function validateUpdates(schema: Schema, updates: unknown): { clean: Record<string, unknown>; rejected: string[] } {
  const rejected: string[] = []
  const clean = validateSchema(schema, updates, '', rejected) ?? {}
  return { clean, rejected }
}

export function createConfigModule<T extends object>(options: {
  filePath: string | (() => string)
  defaults: T
  schema: Schema
  refine?: (clean: DeepPartial<T>, current: T, reject: (path: string) => void) => void
}) {
  const { filePath, defaults, schema, refine } = options
  const store = createFileStore<T>(filePath)
  const log = createLogger('CONFIG')

  // read from disk on first use, not when the module is imported
  let config: T | null = null
  const current = (): T => (config ??= store.load(defaults))

  const save = () =>
    store.scheduleSave(
      () => current(),
      (error) => log.error(`Failed to save ${store.path()}: ${describeError(error)}`)
    )

  function validateConfigUpdates(updates: unknown, against: T = current()) {
    const { clean: validated, rejected } = validateUpdates(schema, updates)
    const clean = validated as DeepPartial<T>
    refine?.(clean, against, (path) => rejected.push(path))
    return { clean, rejected }
  }

  function updateConfig(updates: DeepPartial<T>) {
    const { clean, rejected } = validateConfigUpdates(updates)
    config = deepMerge(current(), clean)
    save()
    return { config: structuredClone(config), rejected }
  }

  function restoreConfig(snapshot: T): void {
    config = structuredClone(snapshot)
    save()
  }

  return { getConfig: (): T => structuredClone(current()), validateConfigUpdates, updateConfig, restoreConfig }
}
