import { isDeepStrictEqual } from 'node:util'
import { getConfig, updateConfig, onConfigChange } from './config.js'
import { fetchPlaylistSongs } from './youtube/index.js'
import { Song, QueueItem, FallbackPlaylist, FallbackStateResponse, AppError } from './types.js'
import { addSong, getCurrent, setCurrent } from './queue.js'
import { finishItem } from './finish.js'
import { on, emit } from './state-events.js'
import { isBlocked, markBlocked } from './blocklist.js'
import { createStore } from './store.js'
import { requestStateSave } from './state-persistence.js'
import { createLogger, describeError } from './logger.js'

const log = createLogger('FALLBACK')

// The stable marker every playlist track carries in `requestedBy`. The localized name is not stored: it is
// put in wherever the track is shown, so it follows the reader's language however long the track sits there
const FALLBACK_REQUESTER = 'playlist'

export type FallbackSnapshot = {
  sourceTracks: Song[]
  order: string[]
  cursor: number
  playlistId: string | null
  lastRefreshedAt: number | null
  itemCount: number | null
}

type Rotation = {
  tracksById: Map<string, Song>
  order: string[]
  cursor: number
  playlistId: string | null
  lastRefreshedAt: number | null
  itemCount: number | null
  version: number
}

const emptyRotation = (): Rotation => ({ tracksById: new Map(), order: [], cursor: -1, playlistId: null, lastRefreshedAt: null, itemCount: null, version: 0 })

let rotation = emptyRotation()

// the rotation is part of the playing state: the store saves and announces it when it changes
const rotationStore = createStore({
  read: () => ({
    tracks: rotation.version,
    order: rotation.order,
    cursor: rotation.cursor,
    playlistId: rotation.playlistId,
    lastRefreshedAt: rotation.lastRefreshedAt,
    itemCount: rotation.itemCount
  }),
  topics: ['state'],
  save: requestStateSave
})

function replaceSourceTracks(tracks: Song[]): void {
  rotation = {
    ...rotation,
    tracksById: new Map(tracks.map((track) => [track.videoId, track])),
    version: rotation.version + 1
  }
}

function resetRotation(): void {
  rotation = { ...emptyRotation(), version: rotation.version + 1 }
}

function findTrack(videoId: string): Song | undefined {
  return rotation.tracksById.get(videoId)
}

function activeFallbackVideoId(): string | null {
  return rotation.order[rotation.cursor] ?? null
}

function anchoredVideoId(): string | null {
  const current = getCurrent()
  return current?.isFallback ? current.videoId : activeFallbackVideoId()
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

function findNext(): { index: number; song: Song } | null {
  const { enabled, repeat } = getConfig().fallbackPlaylist
  const total = rotation.order.length
  if (!enabled) return null

  for (let step = 1; step <= total; step++) {
    let index = rotation.cursor + step
    if (index >= total) {
      if (!repeat) return null
      index %= total
    }
    const song = findTrack(rotation.order[index])
    if (song && !isBlocked(song.videoId)) return { index, song }
  }
  return null
}

export function peekNextFallbackTrack(): QueueItem | null {
  const next = findNext()
  return next ? toFallbackQueueItem(next.song) : null
}

export function advanceFallback(): QueueItem | null {
  const next = findNext()
  if (!next) return null

  rotationStore.update(() => {
    rotation.cursor = next.index
  })

  return toFallbackQueueItem(next.song)
}

// the playlist view the panel reads: the answer of getFallbackState() without the blocked marks (those follow the
// blocklist) and without the playing position (that follows the state the playing store announces)
function fallbackView() {
  const { enabled, shuffle, repeat } = getConfig().fallbackPlaylist

  return {
    playlistId: rotation.playlistId,
    lastRefreshedAt: rotation.lastRefreshedAt,
    enabled,
    shuffle,
    repeat,
    sourceCount: rotation.tracksById.size,
    order: [...rotation.order],
    blocked: rotation.order.map((videoId) => isBlocked(videoId))
  }
}

let announcedView: ReturnType<typeof fallbackView> | null = null

// the 'fallback' announcement is derived, not reported: the view is compared, so a change that does not
// reach it (a viewer track replacing another, a step of the rotation) does not wake the playlist tab
function announceFallbackView(): void {
  const view = fallbackView()
  if (announcedView === null) {
    announcedView = view
    return
  }
  if (isDeepStrictEqual(view, announcedView)) return
  announcedView = view
  emit('fallback')
}

on('state', announceFallbackView)
on('config', announceFallbackView)

// true while a failed load rolls the config back: the playlist it restores must not be loaded again, or two
// playlists that both fail would keep replacing each other forever
let rollingBack = false

const pendingReactions = new Map<string | null, Promise<void>>()

/**
 * Resolves when the reaction the last save of `playlistId` started has settled, so a route that changed the playlist
 * can answer with its outcome. Nobody has to wait: without a caller the reaction runs in the background and the
 * rollback still happens
 */
export function settledConfigReaction(playlistId: string | null): Promise<void> {
  return pendingReactions.get(playlistId) ?? Promise.resolve()
}

function loadPlaylist(playlistId: string | null, rollbackTo: string | null): void {
  const load = refreshFallback().then(
    () => {},
    (error) => {
      // the playlist was replaced while it was loading: the failure is stale, the newer save wins
      if (getConfig().fallbackPlaylist.playlistId !== playlistId) return
      log.error(`Playlist ${playlistId ?? 'none'} could not be loaded, ${rollbackTo ?? 'no playlist'} is kept instead: ${describeError(error)}`)
      rollingBack = true
      try {
        updateConfig({ fallbackPlaylist: { playlistId: rollbackTo } })
      } finally {
        rollingBack = false
      }
      throw error
    }
  )
  // a caller that awaits takes the failure; without one the rollback has already run and only the answer is dropped
  load.catch(() => {})
  pendingReactions.set(playlistId, load)
  load
    .finally(() => {
      if (pendingReactions.get(playlistId) === load) pendingReactions.delete(playlistId)
    })
    .catch(() => {})
}

onConfigChange((previous, next) => {
  const before = previous.fallbackPlaylist
  const after = next.fallbackPlaylist

  if (after.playlistId !== before.playlistId) {
    // a rollback restores the id the rotation already holds, and one that was never loaded stays unloaded
    if (!rollingBack && after.playlistId !== rotation.playlistId) loadPlaylist(after.playlistId, before.playlistId)
  } else if (after.shuffle !== before.shuffle) {
    reorderFallback(after.shuffle)
  }

  // what plays next depends on these, although the rotation itself does not change
  if (after.enabled !== before.enabled || after.repeat !== before.repeat) rotationStore.announce()
})

export async function refreshFallback(): Promise<FallbackStateResponse> {
  const playlistId = getConfig().fallbackPlaylist.playlistId

  if (!playlistId) {
    rotationStore.update(() => resetRotation())
    return getFallbackState()
  }

  const { songs: newTracks, truncated, itemCount } = await fetchPlaylistSongs(playlistId)
  if (truncated) log.info(`Playlist was truncated due to page limit (${newTracks.length} tracks loaded)`)

  const config = getConfig()

  if (config.fallbackPlaylist.playlistId !== playlistId) {
    log.info(`Refresh for "${playlistId}" discarded - playlist changed during load`)
    return getFallbackState()
  }

  const playingId = anchoredVideoId()

  rotationStore.update(() => {
    replaceSourceTracks(newTracks)
    rotation.order = buildOrder(newTracks, config.fallbackPlaylist.shuffle, playingId)
    rotation.cursor = playingId ? rotation.order.indexOf(playingId) : -1
    rotation.playlistId = playlistId
    rotation.lastRefreshedAt = Date.now()
    rotation.itemCount = itemCount
  })

  log.info(`Loaded ${rotation.tracksById.size} tracks from playlist ${playlistId}`)
  return getFallbackState()
}

/** Re-orders the rotation for the given shuffle mode, keeping the playing track in place. Does not touch the config. */
export function reorderFallback(shuffleOn: boolean): void {
  const activeId = anchoredVideoId()

  rotationStore.update(() => {
    rotation.order = buildOrder([...rotation.tracksById.values()], shuffleOn, activeId)
    rotation.cursor = activeId ? rotation.order.indexOf(activeId) : -1
  })
}

type FallbackFlag = 'shuffle' | 'repeat' | 'enabled'

function toggleFallbackFlag(flag: FallbackFlag): FallbackStateResponse {
  const next = !getConfig().fallbackPlaylist[flag]
  const patch: Partial<Pick<FallbackPlaylist, FallbackFlag>> = { [flag]: next }

  updateConfig({ fallbackPlaylist: patch })

  log.info(`${flag}: ${next}`)
  return getFallbackState()
}

export const toggleFallbackShuffle = (): FallbackStateResponse => toggleFallbackFlag('shuffle')
export const toggleFallbackRepeat = (): FallbackStateResponse => toggleFallbackFlag('repeat')
export const toggleFallbackEnabled = (): FallbackStateResponse => toggleFallbackFlag('enabled')

export function clearFallback(): FallbackStateResponse {
  rotationStore.update(() => resetRotation())

  updateConfig({ fallbackPlaylist: { playlistId: null } })
  log.info('cleared')
  return getFallbackState()
}

export function getFallbackState(): FallbackStateResponse {
  const config = getConfig()
  const current = getCurrent()

  return {
    playlistId: rotation.playlistId,
    lastRefreshedAt: rotation.lastRefreshedAt,
    enabled: config.fallbackPlaylist.enabled,
    shuffle: config.fallbackPlaylist.shuffle,
    repeat: config.fallbackPlaylist.repeat,
    sourceCount: rotation.tracksById.size,
    itemCount: rotation.itemCount,
    activeVideoId: current?.isFallback ? current.videoId : null,
    upNext: markBlocked(
      rotation.order
        .map((videoId) => findTrack(videoId))
        .filter((track): track is Song => track !== undefined && track !== null)
    )
  }
}

export function playFallbackTrackNow(videoId: string): QueueItem | null {
  const index = rotation.order.indexOf(videoId)
  if (index === -1) return null

  const song = findTrack(videoId)
  if (!song) return null

  if (isBlocked(videoId)) {
    throw new AppError('BLOCKED')
  }

  // choosing a track to play right away skips whatever is playing now, open reward and all
  finishItem(getCurrent(), 'skipped')

  rotationStore.update(() => {
    rotation.cursor = index
  })
  const item = toFallbackQueueItem(song)
  setCurrent(item)
  log.info(`Play now: "${song.title}"`)
  return item
}

export function queueFallbackTrack(videoId: string): QueueItem | null {
  const song = findTrack(videoId)
  if (!song) return null

  return addSong(song, FALLBACK_REQUESTER, { bypassFilters: true, isFallback: true }).item
}

export function getFallbackSnapshot(): FallbackSnapshot & { sourceVersion: number } {
  return {
    sourceTracks: [...rotation.tracksById.values()],
    order: [...rotation.order],
    cursor: rotation.cursor,
    playlistId: rotation.playlistId,
    lastRefreshedAt: rotation.lastRefreshedAt,
    itemCount: rotation.itemCount,
    sourceVersion: rotation.version
  }
}

// The rotation order of the saved state, repaired: ids without a saved track are appended, a repeated id
// keeps one place. `repaired` says whether anything had to change
function repairedOrder(data: Partial<FallbackSnapshot>): { order: string[]; repaired: boolean } {
  const tracks = data.sourceTracks ?? []
  const savedOrder = data.order ?? []
  const known = new Set(tracks.map((track) => track.videoId))
  const kept = [...new Set(savedOrder.filter((id) => known.has(id)))]
  const keptIds = new Set(kept)

  const missing: string[] = []
  for (const id of known) {
    if (!keptIds.has(id)) missing.push(id)
  }

  const order = [...kept, ...missing]
  const repaired = savedOrder.length !== order.length || order.some((id, index) => id !== savedOrder[index])
  return { order, repaired }
}

// The position starts over when the order was repaired, and moves under the track that is playing if it is
// one of the rotation's
function restoredCursor(data: Partial<FallbackSnapshot>, order: string[], repaired: boolean): number {
  let cursor = repaired ? -1 : data.cursor ?? -1

  const current = getCurrent()
  if (current?.isFallback) {
    const index = order.indexOf(current.videoId)
    if (index >= 0) cursor = index
  }

  return cursor
}

export function hydrateFallback(data: Partial<FallbackSnapshot> | undefined): void {
  if (!data) return

  const { order, repaired } = repairedOrder(data)

  rotation = {
    tracksById: new Map((data.sourceTracks ?? []).map((track) => [track.videoId, track])),
    order,
    cursor: restoredCursor(data, order, repaired),
    playlistId: data.playlistId ?? null,
    lastRefreshedAt: data.lastRefreshedAt ?? null,
    itemCount: data.itemCount ?? null,
    version: rotation.version + 1
  }

  // the hydrated state is what a panel that connects now would read: the view announcements start from it
  announcedView = fallbackView()
}
