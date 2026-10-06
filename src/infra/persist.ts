import { existsSync, readFileSync, renameSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getCacheDir, getDataDir } from './runtime.js'
import { createLogger, describeError } from './logger.js'

const SAVE_DEBOUNCE_MS = 250

const log = createLogger('PERSIST')

// Paths are resolved when they are used, never at import time, so nothing depends on the cwd of the first import
export const dataPath = (name: string): string => join(getDataDir(), name)
export const cachePath = (name: string): string => join(getCacheDir(), name)

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

export function deepMerge<T>(defaults: T, data: DeepPartial<T>): T {
  if (
    defaults === null ||
    data === null ||
    typeof defaults !== 'object' ||
    typeof data !== 'object' ||
    Array.isArray(defaults) ||
    Array.isArray(data)
  ) {
    return data as T
  }

  const result = { ...defaults } as Record<string, unknown>

  for (const key of Object.keys(data)) {
    const value = (data as Record<string, unknown>)[key]
    const defaultValue = result[key]

    if (
      value &&
      defaultValue &&
      typeof value === 'object' &&
      typeof defaultValue === 'object' &&
      !Array.isArray(value) &&
      !Array.isArray(defaultValue)
    ) {
      result[key] = deepMerge(defaultValue, value as DeepPartial<typeof defaultValue>)
    } else if (value !== undefined) {
      result[key] = value
    }
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

export function createFileStore<T>(location: string | (() => string)) {
  const resolvePath = typeof location === 'function' ? location : () => location

  type SaveJob = { getData: () => T; onError: (error: unknown) => void }

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let saveChain: Promise<void> = Promise.resolve()
  let pending: SaveJob | null = null

  function load(defaults: T): T {
    const filePath = resolvePath()
    if (!existsSync(filePath)) return defaults

    try {
      const data = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<T>
      return deepMerge(defaults, data)
    } catch (error) {
      log.error(`Failed to load ${filePath}: ${describeError(error)}`)
      setAside(filePath)
      return defaults
    }
  }

  async function persistNow(getData: () => T): Promise<void> {
    const filePath = resolvePath()
    const tmpPath = `${filePath}.tmp`

    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(tmpPath, JSON.stringify(getData()), 'utf8')
    await rename(tmpPath, filePath)
  }

  function enqueue(job: SaveJob): void {
    saveChain = saveChain.then(() => persistNow(job.getData)).catch(job.onError)
  }

  function scheduleSave(getData: () => T, onError: (error: unknown) => void): void {
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
    flush,
    path: resolvePath
  }
}

export async function flushAllStores(): Promise<void> {
  await Promise.allSettled(activeStoreFlushers.map((flush) => flush()))
}
