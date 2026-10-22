import { existsSync, readFileSync, renameSync } from 'node:fs'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { dirname, join } from 'node:path'
import { getCacheDir, getDataDir } from './runtime.js'
import { createLogger, describeError } from './logger.js'
import { createStore } from './store.js'
import type { Topic } from './state-events.js'

const SAVE_DEBOUNCE_MS = 250
const SAVE_ATTEMPTS = 3
const SAVE_RETRY_DELAY_MS = 150

const RETRYABLE_SAVE_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])

const log = createLogger('PERSIST')

// Paths are resolved when they are used, never at import time, so nothing depends on the cwd of the first import
export const dataPath = (name: string): string => join(getDataDir(), name)
export const cachePath = (name: string): string => join(getCacheDir(), name)

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

export const isPlain = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const kindOf = (value: unknown): string => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'list'
  return isPlain(value) ? 'object' : typeof value
}

// Two plain objects are merged key by key; anything else (a list, a null, a value of another kind) is taken from `data` as it is
export function deepMerge<T>(defaults: T, data: DeepPartial<T>): T {
  if (!isPlain(defaults) || !isPlain(data)) return data as T

  const result: Record<string, unknown> = { ...defaults }

  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) result[key] = deepMerge(result[key], value as DeepPartial<unknown>)
  }

  return result as T
}

// An unreadable file is kept next to the original instead of being overwritten by the next save
function setAside(filePath: string): void {
  const aside = `${filePath}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`

  try {
    renameSync(filePath, aside)
    log.warn(`The unreadable file was kept as ${aside}`)
  } catch (error) {
    log.error(`Could not set aside ${filePath}: ${describeError(error)}`)
  }
}

const activeStoreFlushers: Array<() => Promise<void>> = []

// `options` exists for the tests: a rename that keeps failing and a short retry delay are injected per
// store, so no test reaches into the module's own state
export function createFileStore<T>(location: string | (() => string), options: { rename?: typeof rename; retryDelayMs?: number } = {}) {
  const resolvePath = typeof location === 'function' ? location : () => location
  const renameFile = options.rename ?? rename
  const retryDelayMs = options.retryDelayMs ?? SAVE_RETRY_DELAY_MS

  type SaveJob = { getData: () => T; onError?: (error: unknown) => void }

  const reportError = (error: unknown): void => log.error(`Failed to save ${resolvePath()}: ${describeError(error)}`)

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let saveChain: Promise<void> = Promise.resolve()
  let pending: SaveJob | null = null

  function load(defaults: T): T {
    const filePath = resolvePath()
    if (!existsSync(filePath)) return defaults

    try {
      const data: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
      if (kindOf(data) !== kindOf(defaults)) {
        log.warn(`${filePath} holds a ${kindOf(data)} where a ${kindOf(defaults)} belongs, using the defaults`)
        // kept aside like a corrupt file, so the next save cannot silently erase the only copy
        setAside(filePath)
        return defaults
      }
      return deepMerge(defaults, data as DeepPartial<T>)
    } catch (error) {
      log.error(`Failed to load ${filePath}: ${describeError(error)}`)
      setAside(filePath)
      return defaults
    }
  }

  async function persistNow(getData: () => T): Promise<void> {
    const filePath = resolvePath()
    const tmpPath = `${filePath}.tmp`

    for (let attempt = 1; attempt <= SAVE_ATTEMPTS; attempt++) {
      try {
        await mkdir(dirname(filePath), { recursive: true })
        const handle = await open(tmpPath, 'w')
        try {
          await handle.writeFile(JSON.stringify(getData()), 'utf8')
          await handle.sync()
        } finally {
          await handle.close()
        }
        await renameFile(tmpPath, filePath)
        return
      } catch (error) {
        if (attempt === SAVE_ATTEMPTS || !RETRYABLE_SAVE_CODES.has((error as NodeJS.ErrnoException).code ?? '')) {
          await rm(tmpPath, { force: true }).catch(() => {})
          throw error
        }
        await sleep(retryDelayMs)
      }
    }
  }

  function saveNow(getData: () => T, onError?: (error: unknown) => void): Promise<void> {
    const settled = saveChain.then(() => persistNow(getData)).catch(onError ?? reportError)
    saveChain = settled.then(
      () => {},
      () => {}
    )
    return settled
  }

  function enqueue(job: SaveJob): void {
    saveChain = saveChain.then(() => persistNow(job.getData)).catch(job.onError ?? reportError)
  }

  function scheduleSave(getData: () => T, onError?: (error: unknown) => void): void {
    pending = { getData, onError }
    if (saveTimer) clearTimeout(saveTimer)

    saveTimer = setTimeout(() => {
      saveTimer = null
      const job = pending
      pending = null
      if (job) enqueue(job)
    }, SAVE_DEBOUNCE_MS)
  }

  async function flush(): Promise<void> {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }

    if (pending) {
      const job = pending
      pending = null
      enqueue(job)
    }

    await saveChain
  }

  activeStoreFlushers.push(flush)

  return {
    load,
    scheduleSave,
    saveNow,
    flush,
    path: resolvePath
  }
}

export async function ensureDataDirectory(): Promise<void> {
  const dir = getDataDir()
  const probe = join(dir, '.write-test')

  try {
    await mkdir(dir, { recursive: true })
    const handle = await open(probe, 'w')
    await handle.close()
    await rm(probe, { force: true })
    log.info(`Data directory: ${dir}`)
  } catch (error) {
    log.error(`The data directory ${dir} is not writable: ${describeError(error)}. Nothing the app saves will survive a restart`)
  }
}

/**
 * Reads a file that holds a list. Valid JSON is not always what the code expects (a file edited by hand, one left by an
 * older version): what is not a list becomes an empty one, and an item that fails `isItem` is dropped
 */
function loadList<T>(store: { load: (defaults: T[]) => T[]; path: () => string }, isItem: (value: unknown) => value is T): T[] {
  const stored: unknown = store.load([])

  if (!Array.isArray(stored)) {
    log.warn(`${store.path()} does not hold a list, it is ignored`)
    return []
  }

  const items = stored.filter(isItem)
  if (items.length !== stored.length) log.warn(`Ignored ${stored.length - items.length} invalid entries in ${store.path()}`)

  return items
}

/**
 * A file-backed list: loaded lazily, changed only through update(), which compares the list before and after,
 * saves it once and announces the topics. `limit` caps the list as it is read from disk; what a module does
 * about its own limit while the list grows is that module's business
 */
export function createListStore<T>(options: { file: () => string; guard: (value: unknown) => value is T; limit?: number; topics: readonly Topic[] }) {
  const store = createFileStore<T[]>(options.file)
  const { guard, limit, topics } = options
  let loaded: T[] | null = null

  // read from disk on first use, not when the module is imported
  const list = (): T[] => (loaded ??= limit === undefined ? loadList(store, guard) : loadList(store, guard).slice(0, limit))

  const changes = createStore({ read: list, topics, save: () => store.scheduleSave(list) })

  return {
    all: (): T[] => [...list()],
    // in-place mutation: update() compares, saves and announces
    update: (mutate: (list: T[]) => void): void => changes.update(() => mutate(list()))
  }
}

export async function flushAllStores(): Promise<void> {
  await Promise.allSettled(activeStoreFlushers.map((flush) => flush()))
}
