import { isDeepStrictEqual } from 'node:util'
import { createFileStore, deepMerge, isPlain, type DeepPartial } from './persist.js'
import { createLogger, describeError } from './logger.js'
import { emit, type Topic } from './state-events.js'

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

const isRule = (entry: FieldRule | Schema): entry is FieldRule => FIELD in entry

function validateSchema(schema: Schema, raw: unknown, path: string, rejected: string[]): Record<string, unknown> | undefined {
  if (!isPlain(raw)) {
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

// A deep readonly view of a config: getConfig() hands out the live object instead of a clone per read,
// so every read stops paying structuredClone (every chat message, every /api/state); the type keeps hands off it.
// A mutable config stays assignable to it, so tests and callers that build their own object keep compiling.
export type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends (...args: never[]) => unknown ? T[K] : T[K] extends object ? DeepReadonly<T[K]> : T[K]
}

export function createConfigModule<T extends object>(options: {
  filePath: string | (() => string)
  defaults: T
  schema: Schema
  refine?: (clean: DeepPartial<T>, current: T, reject: (path: string) => void) => void
  // what a saved change announces; the overlay follows the playing state, the panel the config
  topics?: readonly Topic[]
}) {
  const { filePath, defaults, schema, refine, topics } = options
  const store = createFileStore<T>(filePath)
  const log = createLogger('CONFIG')
  const changeListeners = new Set<(previous: T, next: T) => void>()

  // Read from disk on first use, not when the module is imported. A file edited by hand (or left by an older version)
  // may hold what the schema would refuse: those values are ignored and the defaults stay in their place
  function loadChecked(): T {
    const { clean, rejected } = validateConfigUpdates(store.load(defaults), defaults)
    if (rejected.length) log.warn(`Ignored invalid values in ${store.path()}: ${rejected.join(', ')}`)
    return deepMerge(defaults, clean)
  }

  let config: T | null = null
  const current = (): T => (config ??= loadChecked())

  const save = () => store.scheduleSave(() => current())

  function validateConfigUpdates(updates: unknown, against: T = current()) {
    const { clean: validated, rejected } = validateUpdates(schema, updates)
    const clean = validated as DeepPartial<T>
    refine?.(clean, against, (path) => rejected.push(path))
    return { clean, rejected }
  }

  function commit(clean: DeepPartial<T>): { config: DeepReadonly<T>; changed: boolean } {
    const previous = current()
    const next = deepMerge(previous, clean)
    const changed = !isDeepStrictEqual(next, previous)
    config = next
    if (changed) {
      save()
      announce(previous, next)
    }
    return { config: next as DeepReadonly<T>, changed }
  }

  function updateConfig(updates: DeepPartial<T>) {
    const { clean, rejected } = validateConfigUpdates(updates)
    const { config, changed } = commit(clean)
    return { config, rejected, changed }
  }

  // All-or-nothing: for updates that come from one form and must not land half-applied (the secrets:
  // a valid API key must not be saved while a bad field of the same request is refused). Validates once.
  function updateConfigStrict(updates: DeepPartial<T>): { rejected: string[]; changed: boolean } {
    const { clean, rejected } = validateConfigUpdates(updates)
    if (rejected.length) return { rejected, changed: false }
    return { rejected, ...commit(clean) }
  }

  function announce(previous: T, next: T): void {
    for (const topic of topics ?? []) emit(topic)
    for (const listener of [...changeListeners]) {
      try {
        listener(previous, next)
      } catch (error) {
        log.error(`A listener of a config change failed: ${describeError(error)}`)
      }
    }
  }

  // The listener gets the config before and after a saved change, so it can react to what actually differs
  function onConfigChange(listener: (previous: T, next: T) => void): () => void {
    changeListeners.add(listener)
    return () => {
      changeListeners.delete(listener)
    }
  }

  return {
    getConfig: (): DeepReadonly<T> => current(),
    validateConfigUpdates,
    updateConfig,
    updateConfigStrict,
    onConfigChange,
    saveNow: async (onError?: (error: unknown) => void) => {
      await store.saveNow(() => current(), onError)
    }
  }
}
