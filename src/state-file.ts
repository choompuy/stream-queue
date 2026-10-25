import { createFileStore, dataPath, isPlain } from './persist.js'
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

// A number read from disk becomes null when it is not one (or falls under the minimum)
const numberOrNull = (value: unknown, min = -Infinity): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= min ? value : null

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

// The track list of the rotation, deduplicated: an unusable entry and a second copy of a video cost only themselves
function sanitizeTracks(raw: unknown): { tracks: Song[]; dropped: number } {
  const rawTracks = Array.isArray(raw) ? raw : []
  const byId = new Map<string, Song>()

  for (const item of rawTracks) {
    const song = sanitizeSong(item)
    if (song && !byId.has(song.videoId)) byId.set(song.videoId, song)
  }

  return { tracks: [...byId.values()], dropped: rawTracks.length - byId.size }
}

// The rotation order is kept only whole: a damaged one is dropped, and the load rebuilds it from the tracks
function sanitizeOrder(raw: unknown): { order: string[]; clean: boolean } {
  const rawOrder = Array.isArray(raw) ? raw : []
  const order = [...new Set(rawOrder.filter((id): id is string => typeof id === 'string'))]
  return { order, clean: order.length === rawOrder.length }
}

// The position survives only together with the order it points into, and only inside its bounds
function sanitizeCursor(raw: unknown, clean: boolean, orderLength: number): number {
  return clean && Number.isInteger(raw) && (raw as number) >= -1 && (raw as number) < orderLength ? (raw as number) : -1
}

function sanitizeFallback(raw: unknown, problems: string[]): FallbackSnapshot | undefined {
  if (raw === undefined) return undefined
  if (!isPlain(raw)) {
    problems.push('fallback is not an object, ignored')
    return undefined
  }

  const { tracks, dropped } = sanitizeTracks(raw.sourceTracks)
  if (dropped) problems.push(`fallback: dropped ${dropped} invalid or duplicate track(s)`)

  const { order, clean } = sanitizeOrder(raw.order)
  if (!clean) problems.push('fallback: rotation is damaged, reset')

  return {
    sourceTracks: tracks,
    order: clean ? order : [],
    cursor: sanitizeCursor(raw.cursor, clean, order.length),
    playlistId: isValidPlaylistId(raw.playlistId) ? raw.playlistId : null,
    lastRefreshedAt: numberOrNull(raw.lastRefreshedAt),
    itemCount: numberOrNull(raw.itemCount, 0)
  }
}

// The track that is playing now: unusable when damaged, null when the state named none
function sanitizeCurrent(raw: unknown, problems: string[]): QueueItem | null {
  if (raw === undefined || raw === null) return null

  const current = sanitizeQueueItem(raw)
  if (!current) problems.push('current track is invalid, dropped')
  return current
}

// The videos that already hold a place: the track playing now, unless it is one of the rotation's (a fallback
// track playing now does not hide the same track queued by a viewer)
function occupiedVideos(current: QueueItem | null): Set<string> {
  return new Set(current && !current.isFallback ? [current.videoId] : [])
}

// The queue without its unusable and repeating tracks
function sanitizeQueue(raw: unknown, current: QueueItem | null, problems: string[]): QueueItem[] {
  if (raw !== undefined && !Array.isArray(raw)) problems.push('queue is not a list, ignored')

  const seen = occupiedVideos(current)
  const queue: QueueItem[] = []
  let invalid = 0
  let duplicates = 0

  for (const item of Array.isArray(raw) ? raw : []) {
    const clean = sanitizeQueueItem(item)
    if (!clean) invalid++
    else if (seen.has(clean.videoId)) duplicates++
    else {
      seen.add(clean.videoId)
      queue.push(clean)
    }
  }

  if (invalid) problems.push(`queue: dropped ${invalid} invalid item(s)`)
  if (duplicates) problems.push(`queue: dropped ${duplicates} duplicate item(s)`)
  return queue
}

// Turns whatever was read from disk into something safe to load. Every part is repaired on its own:
// a bad queue item, a bad setting or a bad fallback entry costs only itself, never the other parts
export function sanitizeState(raw: unknown): SanitizedState {
  const problems: string[] = []
  if (!isPlain(raw)) problems.push('state file is not an object, using defaults')
  const data = isPlain(raw) ? raw : {}

  const current = sanitizeCurrent(data.current, problems)
  const queue = sanitizeQueue(data.queue, current, problems)

  return { current, queue, fallback: sanitizeFallback(data.fallback, problems), problems }
}

const store = createFileStore<Partial<StateFile>>(() => dataPath('queue-state.json'))
const tracksStore = createFileStore<TracksFile>(() => dataPath('fallback-tracks.json'))

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
