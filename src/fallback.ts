import { getConfig, updateConfig } from './config.js'
import { fetchPlaylistSongs } from './youtube/index.js'
import { Song, QueueItem, Config, FallbackPlaylist, FallbackStateResponse, AppError } from './types.js'
import { addSong, getCurrent, setCurrent } from './queue.js'
import { emit } from './state-events.js'
import { isBlocked } from './blocklist.js'
import { createLogger } from './logger.js'

const log = createLogger('FALLBACK')

export const FALLBACK_REQUESTER = 'Playlist'

export type FallbackSnapshot = {
  sourceTracks: Song[]
  order: string[]
  cursor: number
  playlistId: string | null
  lastRefreshedAt: number | null
}

let fallbackTracksById = new Map<string, Song>()
let fallbackOrder: string[] = []
let fallbackCursor = -1
let loadedFallbackPlaylistId: string | null = null
let lastFallbackRefreshAt: number | null = null

// Grows every time the set of playlist tracks is replaced, so the saved copy of the (large) track list
// is rewritten only then and not on every change of position
let sourceVersion = 0

function setSourceTracks(tracks: Song[]): void {
  fallbackTracksById = new Map(tracks.map((track) => [track.videoId, track]))
  sourceVersion++
}

function resetRotation(): void {
  setSourceTracks([])
  fallbackOrder = []
  fallbackCursor = -1
  loadedFallbackPlaylistId = null
  lastFallbackRefreshAt = null
}

export const getFallbackSourceVersion = (): number => sourceVersion

function findTrack(videoId: string): Song | undefined {
  return fallbackTracksById.get(videoId)
}

function activeFallbackVideoId(): string | null {
  return fallbackOrder[fallbackCursor] ?? null
}

function shuffle<T>(items: T[]): T[] {
  const array = [...items]

  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[array[i], array[j]] = [array[j], array[i]]
  }

  return array
}

function buildOrder(tracks: Song[], shuffleOn: boolean, currentVideoId: string | null): string[] {
  const ids = tracks.map((track) => track.videoId)

  if (!shuffleOn) return ids
  if (!currentVideoId || !ids.includes(currentVideoId)) return shuffle(ids)

  const rest = ids.filter((id) => id !== currentVideoId)
  return [currentVideoId, ...shuffle(rest)]
}

function toFallbackQueueItem(song: Song): QueueItem {
  return {
    ...song,
    requestedBy: FALLBACK_REQUESTER,
    isFallback: true
  }
}

function computeNextIndex(config: Config, cursor: number): number | null {
  if (!config.fallbackPlaylist.enabled || !fallbackOrder.length) return null

  const nextIndex = cursor + 1
  if (nextIndex < fallbackOrder.length) return nextIndex

  return config.fallbackPlaylist.repeat ? 0 : null
}

export function peekNextFallbackTrack(): QueueItem | null {
  const config = getConfig()
  const attempts = fallbackOrder.length || 1
  let cursor = fallbackCursor

  for (let i = 0; i < attempts; i++) {
    const nextIndex = computeNextIndex(config, cursor)
    if (nextIndex === null) return null

    cursor = nextIndex
    const song = findTrack(fallbackOrder[cursor])
    if (song && !isBlocked(song.videoId)) return toFallbackQueueItem(song)
  }

  return null
}

export function advanceFallback(): QueueItem | null {
  const config = getConfig()
  const attempts = fallbackOrder.length || 1

  for (let i = 0; i < attempts; i++) {
    const nextIndex = computeNextIndex(config, fallbackCursor)

    if (nextIndex === null) {
      if (config.fallbackPlaylist.enabled && fallbackOrder.length) fallbackCursor = fallbackOrder.length
      return null
    }

    fallbackCursor = nextIndex
    const song = findTrack(fallbackOrder[fallbackCursor])
    if (!song || isBlocked(song.videoId)) continue

    return toFallbackQueueItem(song)
  }

  return null
}

export async function refreshFallback(): Promise<FallbackStateResponse> {
  const playlistId = getConfig().fallbackPlaylist.playlistId

  if (!playlistId) {
    resetRotation()
    emit('state')
    emit('fallback')
    return getFallbackState()
  }

  const { songs: newTracks, truncated } = await fetchPlaylistSongs(playlistId)
  if (truncated) {
    log.log(`Playlist was truncated due to page limit (${newTracks.length} tracks loaded)`)
  }
  const config = getConfig()

  if (config.fallbackPlaylist.playlistId !== playlistId) {
    log.log(`Refresh for "${playlistId}" discarded - playlist changed during load`)
    return getFallbackState()
  }

  const isFirstLoad = loadedFallbackPlaylistId !== playlistId
  const activeId = activeFallbackVideoId()

  if (isFirstLoad) {
    setSourceTracks(newTracks)
    fallbackOrder = buildOrder(newTracks, config.fallbackPlaylist.shuffle, null)
    fallbackCursor = -1
  } else {
    const newIds = new Set(newTracks.map((track) => track.videoId))
    const oldIds = new Set(fallbackTracksById.keys())

    const addedIds = newTracks.map((track) => track.videoId).filter((id) => !oldIds.has(id))
    const removedCount = [...oldIds].filter((id) => !newIds.has(id)).length

    setSourceTracks(newTracks)

    const orderBefore = fallbackOrder
    const activeIndexBefore = activeId ? orderBefore.indexOf(activeId) : -1
    fallbackOrder = orderBefore.filter((id) => newIds.has(id))
    fallbackOrder.push(...(config.fallbackPlaylist.shuffle ? shuffle(addedIds) : addedIds))

    if (activeId && newIds.has(activeId)) {
      fallbackCursor = fallbackOrder.indexOf(activeId)
    } else if (activeIndexBefore >= 0) {
      const survivedBeforeActive = orderBefore.slice(0, activeIndexBefore).filter((id) => newIds.has(id)).length
      fallbackCursor = survivedBeforeActive - 1
    }

    log.log(`Refreshed: +${addedIds.length} added, -${removedCount} removed, ${fallbackOrder.length} in rotation`)
  }

  loadedFallbackPlaylistId = playlistId
  lastFallbackRefreshAt = Date.now()

  log.log(`Loaded ${fallbackTracksById.size} tracks from playlist ${playlistId}`)
  emit('state')
  emit('fallback')
  return getFallbackState()
}

/** Re-orders the rotation for the given shuffle mode, keeping the playing track in place. Does not touch the config. */
export function reorderFallback(shuffleOn: boolean): void {
  const current = getCurrent()
  const activeId = current?.isFallback ? current.videoId : activeFallbackVideoId()
  fallbackOrder = buildOrder([...fallbackTracksById.values()], shuffleOn, activeId)
  fallbackCursor = activeId ? fallbackOrder.indexOf(activeId) : -1
  emit('state')
  emit('fallback')
}

type FallbackFlag = 'shuffle' | 'repeat' | 'enabled'

function toggleFallbackFlag(flag: FallbackFlag): FallbackStateResponse {
  const next = !getConfig().fallbackPlaylist[flag]
  const patch: Partial<Pick<FallbackPlaylist, FallbackFlag>> = { [flag]: next }

  updateConfig({ fallbackPlaylist: patch })
  if (flag === 'shuffle') reorderFallback(next)

  log.log(`${flag}: ${next}`)
  return getFallbackState()
}

export const toggleFallbackShuffle = (): FallbackStateResponse => toggleFallbackFlag('shuffle')
export const toggleFallbackRepeat = (): FallbackStateResponse => toggleFallbackFlag('repeat')
export const toggleFallbackEnabled = (): FallbackStateResponse => toggleFallbackFlag('enabled')

export function clearFallback(): FallbackStateResponse {
  resetRotation()

  updateConfig({ fallbackPlaylist: { playlistId: null } })
  emit('state')
  emit('fallback')
  log.log('cleared')
  return getFallbackState()
}

export function getFallbackState(): FallbackStateResponse {
  const config = getConfig()
  const current = getCurrent()

  return {
    playlistId: loadedFallbackPlaylistId,
    lastRefreshedAt: lastFallbackRefreshAt,
    enabled: config.fallbackPlaylist.enabled,
    shuffle: config.fallbackPlaylist.shuffle,
    repeat: config.fallbackPlaylist.repeat,
    sourceCount: fallbackTracksById.size,
    activeVideoId: current?.isFallback ? current.videoId : null,
    upNext: fallbackOrder
      .map((videoId) => {
        const track = findTrack(videoId)
        if (!track) return null
        return { ...track }
      })
      .filter((track): track is Song => track !== null)
  }
}

export function playFallbackTrackNow(videoId: string): QueueItem | null {
  const index = fallbackOrder.indexOf(videoId)
  if (index === -1) return null

  const song = findTrack(videoId)
  if (!song) return null

  if (isBlocked(videoId)) {
    throw new AppError('BLOCKED', 'this track is blocked')
  }

  fallbackCursor = index
  const item = toFallbackQueueItem(song)
  setCurrent(item)
  log.log(`Play now: "${song.title}"`)
  return item
}

export function queueFallbackTrack(videoId: string): QueueItem | null {
  const song = findTrack(videoId)
  if (!song) return null

  return addSong(song, FALLBACK_REQUESTER, { bypassLimits: true })
}

export const getFallbackSourceTracks = (): Song[] => [...fallbackTracksById.values()]

export function getFallbackProgress(): Omit<FallbackSnapshot, 'sourceTracks'> {
  return {
    order: [...fallbackOrder],
    cursor: fallbackCursor,
    playlistId: loadedFallbackPlaylistId,
    lastRefreshedAt: lastFallbackRefreshAt
  }
}

export function getFallbackSnapshot(): FallbackSnapshot {
  return { sourceTracks: getFallbackSourceTracks(), ...getFallbackProgress() }
}

export function hydrateFallback(data: Partial<FallbackSnapshot> | undefined): void {
  if (!data) return

  setSourceTracks(data.sourceTracks ?? [])
  fallbackOrder = data.order ?? []
  fallbackCursor = data.cursor ?? -1
  loadedFallbackPlaylistId = data.playlistId ?? null
  lastFallbackRefreshAt = data.lastRefreshedAt ?? null
}
