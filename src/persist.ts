import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isPackaged, getAppRoot } from './runtime.js'

const SAVE_DEBOUNCE_MS = 250

function getDir(dir: string): string {
  if (!isPackaged()) return join(process.cwd(), dir)

  const appData = process.env.LOCALAPPDATA
  if (!appData) return join(getAppRoot(), dir)

  return join(appData, 'StreamQueue', dir)
}

export const DATA_DIR = getDir('data')
export const CACHE_DIR = getDir('cache')

export const CONFIG_PATH = join(DATA_DIR, 'config.json')
export const PLAYLISTS_PATH = join(DATA_DIR, 'playlists.json')
export const SECRETS_PATH = join(DATA_DIR, 'secrets.json')
export const ACTIVITY_PATH = join(DATA_DIR, 'activity.json')
export const BLOCKLIST_PATH = join(DATA_DIR, 'blocklist.json')

export const STATE_FILE = join(CACHE_DIR, 'queue-state.json')
export const CACHE_FILE = join(CACHE_DIR, 'youtube-cache.json')

function deepMerge<T>(defaults: T, data: Partial<T>): T {
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
      result[key] = deepMerge(defaultValue, value)
    } else if (value !== undefined) {
      result[key] = value
    }
  }

  return result as T
}

const activeStoreFlushers: Array<() => Promise<void>> = []

export function createFileStore<T>(filePath: string) {
  const dir = dirname(filePath)
  const tmpPath = `${filePath}.tmp`

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let saveChain: Promise<void> = Promise.resolve()
  let pending: { getData: () => T; onError: (error: unknown) => void } | null = null

  function load(defaults: T): T {
    try {
      if (!existsSync(filePath)) return defaults

      const raw = readFileSync(filePath, 'utf8')
      const data = JSON.parse(raw) as Partial<T>

      return deepMerge(defaults, data)
    } catch (error) {
      console.error(`[PERSIST] Failed to load ${filePath}:`, error instanceof Error ? error.message : error)
      return defaults
    }
  }

  async function persistNow(getData: () => T): Promise<void> {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    await writeFile(tmpPath, JSON.stringify(getData()), 'utf8')
    await rename(tmpPath, filePath)
  }

  function scheduleSave(getData: () => T, onError: (error: unknown) => void): void {
    pending = { getData, onError }
    if (saveTimer) clearTimeout(saveTimer)

    saveTimer = setTimeout(() => {
      saveTimer = null
      const toSave = pending
      pending = null
      saveChain = saveChain.then(() => persistNow(toSave!.getData)).catch(toSave!.onError)
    }, SAVE_DEBOUNCE_MS)
  }

  async function flush(): Promise<void> {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }

    if (pending) {
      const toSave = pending
      pending = null
      saveChain = saveChain.then(() => persistNow(toSave.getData)).catch(toSave.onError)
    }

    await saveChain
  }

  activeStoreFlushers.push(flush)

  return {
    load,
    scheduleSave,
    flush
  }
}

export async function flushAllStores(): Promise<void> {
  await Promise.allSettled(activeStoreFlushers.map((flush) => flush()))
}
