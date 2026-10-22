import { cachePath, createFileStore, dataPath, isPlain } from './persist.js'
import { QueueItem, Song } from './types.js'
import { isValidPlaylistId, isValidVideoId } from './youtube/url.js'
import { getQueue, getCurrent, hydrateQueue } from './queue.js'
import { getFallbackSnapshot, hydrateFallback, FallbackSnapshot } from './fallback.js'
import { bindStatePersistence } from './state-persistence.js'
import { createLogger, describeError } from './logger.js'

export type StateFile = {
  current: QueueItem | null
  queue: QueueItem[]
  fallback: Omit<FallbackSnapshot, 'sourceTracks'>
}

type TracksFile = { sourceTracks: Song[] }

export type SanitizedState = {
  current: QueueItem | null
  queue: QueueItem[]
  fallback: FallbackSnapshot | undefined
  problems: string[]
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const amount = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0)

function sanitizeSong(raw: unknown): Song | null {
  if (!isPlain(raw) || !isValidVideoId(raw.videoId) || !text(raw.title)) return null

  const videoId = raw.videoId

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

function sanitizeRedemption(raw: unknown): QueueItem['channelPointsRedemption'] {
  if (!isPlain(raw)) return undefined

  const id = text(raw.id).trim()
  const rewardId = text(raw.rewardId).trim()
  const userName = text(raw.userName).trim()

  return id && rewardId && userName ? { id, rewardId, userName } : undefined
}

export function sanitizeQueueItem(raw: unknown): QueueItem | null {
  const song = sanitizeSong(raw)
  const requestedBy = isPlain(raw) ? text(raw.requestedBy).trim() : ''
  if (!song || !requestedBy) return null

  // without the redemption a restored track would play, but its Channel Points reward would never be closed
  const redemption = isPlain(raw) ? sanitizeRedemption(raw.channelPointsRedemption) : undefined
  // the play id survives a restart, so a report that arrives late still names the play it belongs to
  const playId = isPlain(raw) && Number.isInteger(raw.playId) && (raw.playId as number) > 0 ? (raw.playId as number) : undefined

  return {
    ...song,
    requestedBy,
    // the flag is read as written: a name alone never marks a track, for a viewer may go by it too
    ...(isPlain(raw) && raw.isFallback === true ? { isFallback: true } : {}),
    ...(playId !== undefined ? { playId } : {}),
    ...(redemption ? { channelPointsRedemption: redemption } : {})
  }
}

function sanitizeFallback(raw: unknown, problems: string[]): FallbackSnapshot | undefined {
  if (raw === undefined) return undefined
  if (!isPlain(raw)) {
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
  const order = [...new Set(rawOrder.filter((id): id is string => typeof id === 'string'))]
  const clean = order.length === rawOrder.length

  // the saved order is kept only whole: a damaged one is dropped, and the load rebuilds it from the tracks
  if (!clean) problems.push('fallback: rotation is damaged, reset')

  const rawCursor = raw.cursor
  const cursor = clean && Number.isInteger(rawCursor) && (rawCursor as number) >= -1 && (rawCursor as number) < order.length ? (rawCursor as number) : -1

  const lastRefreshedAt = raw.lastRefreshedAt
  const itemCount = raw.itemCount

  return {
    sourceTracks: [...tracks.values()],
    order: clean ? order : [],
    cursor,
    playlistId: isValidPlaylistId(raw.playlistId) ? raw.playlistId : null,
    lastRefreshedAt: typeof lastRefreshedAt === 'number' && Number.isFinite(lastRefreshedAt) ? lastRefreshedAt : null,
    itemCount: typeof itemCount === 'number' && Number.isFinite(itemCount) && itemCount >= 0 ? itemCount : null
  }
}

// Turns whatever was read from disk into something safe to load. Every part is repaired on its own:
// a bad queue item, a bad setting or a bad fallback entry costs only itself, never the other parts
export function sanitizeState(raw: unknown): SanitizedState {
  const data = isPlain(raw) ? raw : {}
  const problems: string[] = []

  if (!isPlain(raw)) problems.push('state file is not an object, using defaults')

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

  return { current, queue, fallback: sanitizeFallback(data.fallback, problems), problems }
}

const store = createFileStore<Partial<StateFile>>(() => dataPath('queue-state.json'))
const tracksStore = createFileStore<TracksFile>(() => cachePath('fallback-tracks.json'))

const log = createLogger('STATE')

function stateSnapshot(): StateFile {
  const { sourceVersion: _version, sourceTracks: _tracks, ...fallback } = getFallbackSnapshot()
  return {
    current: getCurrent(),
    queue: getQueue(),
    fallback
  }
}

// -1 until the track list has been saved (or read from its own file), so an older state file gets migrated
let savedTracksVersion = -1

// The stores that own the playing state save through this hook. It is reachable only through the binding that
// initState() makes after the load, so nothing is saved over the not-yet-loaded state
function persistState(): void {
  store.scheduleSave(stateSnapshot)

  const { sourceVersion } = getFallbackSnapshot()
  if (sourceVersion !== savedTracksVersion) {
    savedTracksVersion = sourceVersion
    tracksStore.scheduleSave(
      () => ({ sourceTracks: getFallbackSnapshot().sourceTracks }),
      (error) => {
        savedTracksVersion = -1 // not on disk: written again with the next save
        log.error(`Failed to save the fallback tracks: ${describeError(error)}`)
      }
    )
  }
}

function attempt(part: string, apply: () => void): void {
  try {
    apply()
  } catch (error) {
    log.error(`Failed to load ${part}: ${describeError(error)}`)
  }
}

export function loadState(): void {
  const saved = store.load({})
  const tracks = tracksStore.load({ sourceTracks: [] }).sourceTracks

  // an older state file still carries the tracks inside `fallback`: they are used until the track file exists
  const raw = tracks.length > 0 && isPlain(saved.fallback) ? { ...saved, fallback: { ...saved.fallback, sourceTracks: tracks } } : saved
  const { current, queue, fallback, problems } = sanitizeState(raw)

  for (const problem of problems) log.warn(problem)

  attempt('queue', () => hydrateQueue({ current, queue }))
  // hydrateFallback() also puts the position under the track that is playing, if it is one of the rotation's
  attempt('fallback', () => hydrateFallback(fallback))

  savedTracksVersion = tracks.length > 0 ? getFallbackSnapshot().sourceVersion : -1

  log.info('State loaded from disk')
}

let initialized = false

// Loads the saved state and starts saving every change. Call once, before serving requests
export function initState(): void {
  if (initialized) return
  initialized = true

  loadState()
  bindStatePersistence(persistState)
}
