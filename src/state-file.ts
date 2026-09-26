import { STATE_FILE, createFileStore } from './persist.js'
import { QueueItem, Settings, Song } from './types.js'
import { isValidPlaylistId, isValidVideoId } from './youtube/url.js'
import { getSettings, setSettings, validateSettingsUpdates } from './settings.js'
import { getQueue, getCurrent, hydrateQueue } from './queue.js'
import { getFallbackSnapshot, hydrateFallback, FallbackSnapshot } from './fallback.js'
import { onStateChange } from './state-events.js'
import { createLogger } from './logger.js'

export type StateFile = {
  current: QueueItem | null
  queue: QueueItem[]
  settings: Settings
  fallback: FallbackSnapshot
}

export type SanitizedState = {
  current: QueueItem | null
  queue: QueueItem[]
  settings: Partial<Settings>
  fallback: FallbackSnapshot | undefined
  problems: string[]
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const amount = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0)

export function sanitizeSong(raw: unknown): Song | null {
  if (!isObject(raw) || !isValidVideoId(raw.videoId as string) || !text(raw.title)) return null

  const videoId = raw.videoId as string

  return {
    videoId,
    title: text(raw.title),
    channelTitle: text(raw.channelTitle),
    thumbnail: text(raw.thumbnail),
    duration: amount(raw.duration),
    views: amount(raw.views),
    url: text(raw.url) || `https://www.youtube.com/watch?v=${videoId}`
  }
}

export function sanitizeQueueItem(raw: unknown): QueueItem | null {
  const song = sanitizeSong(raw)
  const requestedBy = isObject(raw) ? text(raw.requestedBy).trim() : ''
  if (!song || !requestedBy) return null

  return { ...song, requestedBy, ...(isObject(raw) && raw.isFallback === true ? { isFallback: true } : {}) }
}

function sanitizeFallback(raw: unknown, problems: string[]): FallbackSnapshot | undefined {
  if (raw === undefined) return undefined
  if (!isObject(raw)) {
    problems.push('fallback is not an object, ignored')
    return undefined
  }

  const rawTracks = Array.isArray(raw.sourceTracks) ? raw.sourceTracks : []
  const tracks = new Map<string, Song>()
  for (const item of rawTracks) {
    const song = sanitizeSong(item)
    if (song && !tracks.has(song.videoId)) tracks.set(song.videoId, song)
  }
  if (tracks.size !== rawTracks.length) problems.push(`fallback: dropped ${rawTracks.length - tracks.size} invalid or duplicate track(s)`)

  const rawOrder = Array.isArray(raw.order) ? raw.order : []
  const order = [...new Set(rawOrder.filter((id): id is string => typeof id === 'string' && tracks.has(id)))]
  const orderChanged = order.length !== rawOrder.length

  const cursor = raw.cursor
  const cursorValid = Number.isInteger(cursor) && (cursor as number) >= -1 && (cursor as number) <= order.length
  if (orderChanged || !cursorValid) problems.push('fallback: rotation repaired, position reset')

  const lastRefreshedAt = raw.lastRefreshedAt

  return {
    sourceTracks: [...tracks.values()],
    order,
    cursor: !orderChanged && cursorValid ? (cursor as number) : -1,
    playlistId: isValidPlaylistId(raw.playlistId) ? raw.playlistId : null,
    lastRefreshedAt: typeof lastRefreshedAt === 'number' && Number.isFinite(lastRefreshedAt) ? lastRefreshedAt : null
  }
}

// Turns whatever was read from disk into something safe to load. Every part is repaired on its own:
// a bad queue item, a bad setting or a bad fallback entry costs only itself, never the other parts
export function sanitizeState(raw: unknown): SanitizedState {
  const data = isObject(raw) ? raw : {}
  const problems: string[] = []

  if (!isObject(raw)) problems.push('state file is not an object, using defaults')

  let current: QueueItem | null = null
  if (data.current !== undefined && data.current !== null) {
    current = sanitizeQueueItem(data.current)
    if (!current) problems.push('current track is invalid, dropped')
  }

  const rawQueue = Array.isArray(data.queue) ? data.queue : []
  const seen = new Set<string>(current && !current.isFallback ? [current.videoId] : [])
  const queue: QueueItem[] = []
  let invalid = 0
  let duplicates = 0

  for (const raw of rawQueue) {
    const item = sanitizeQueueItem(raw)
    if (!item) invalid++
    else if (seen.has(item.videoId)) duplicates++
    else {
      seen.add(item.videoId)
      queue.push(item)
    }
  }

  if (data.queue !== undefined && !Array.isArray(data.queue)) problems.push('queue is not a list, ignored')
  if (invalid) problems.push(`queue: dropped ${invalid} invalid item(s)`)
  if (duplicates) problems.push(`queue: dropped ${duplicates} duplicate item(s)`)

  let settings: Partial<Settings> = {}
  if (data.settings !== undefined) {
    const validated = validateSettingsUpdates(data.settings)
    settings = validated.clean
    if (validated.rejected.length) problems.push(`settings: ignored ${validated.rejected.join(', ')}`)
  }

  return { current, queue, settings, fallback: sanitizeFallback(data.fallback, problems), problems }
}

const store = createFileStore<Partial<StateFile>>(STATE_FILE)

const log = createLogger('STATE')

function stateSnapshot(): StateFile {
  return {
    current: getCurrent(),
    queue: getQueue(),
    settings: getSettings(),
    fallback: getFallbackSnapshot()
  }
}

function persistState(): void {
  store.scheduleSave(stateSnapshot, (error) => {
    log.error(`Failed to save state: ${error instanceof Error ? error.message : error}`)
  })
}

function attempt(part: string, apply: () => void): void {
  try {
    apply()
  } catch (error) {
    log.error(`Failed to load ${part}: ${error instanceof Error ? error.message : error}`)
  }
}

export function loadState(): void {
  const { current, queue, settings, fallback, problems } = sanitizeState(store.load({}))

  for (const problem of problems) log.warn(`${problem}`)

  attempt('queue', () => hydrateQueue({ current, queue }))
  attempt('settings', () => setSettings({ ...getSettings(), ...settings }))
  attempt('fallback', () => hydrateFallback(fallback))

  log.log('State loaded from disk')
}

let initialized = false

// Loads the saved state and starts saving every change. Call once, before serving requests
export function initState(): void {
  if (initialized) return
  initialized = true

  loadState()
  onStateChange(persistState)
}
