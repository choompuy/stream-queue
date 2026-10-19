import { getConfig } from './config.js'
import { QueueItem, Song, AppError } from './types.js'
import { isBlocked } from './blocklist.js'
import { createStore } from './store.js'
import { finishItem } from './finish.js'
import { persistState } from './state-file.js'
import { createLogger } from './logger.js'

let currentSong: QueueItem | null = null
const queue: QueueItem[] = []

let playCounter = 0

// the playing state is saved and announced by the store when it changes
const playing = createStore({
  read: () => ({ current: currentSong, queue }),
  topics: ['state'],
  save: persistState
})

const log = createLogger('QUEUE')

// Everything below is derived from `queue` on demand, so there is no second copy that could drift apart from it
const isQueued = (videoId: string): boolean => queue.some((item) => item.videoId === videoId)

// Whether the track already has a place in the playing state: it is the current one, or it is waiting in the queue
export function isDuplicate(videoId: string): boolean {
  return isActiveNonFallback(videoId) || isQueued(videoId)
}

function getUserActiveCount(username: string): number {
  const key = username.toLowerCase()
  // a blocked track never plays and a playlist track is nobody's request: neither occupies the viewer's slot
  const isTheirs = (item: QueueItem): boolean => !item.isFallback && !isBlocked(item.videoId) && item.requestedBy.toLowerCase() === key

  return queue.filter(isTheirs).length + (currentSong !== null && isTheirs(currentSong) ? 1 : 0)
}

function isActiveNonFallback(videoId: string): boolean {
  return currentSong?.videoId === videoId && !currentSong.isFallback
}

export function hydrateQueue(data: { current?: QueueItem | null; queue?: QueueItem[] }): void {
  if (data.current !== undefined) currentSong = data.current
  playCounter = Math.max(playCounter, data.current?.playId ?? 0)

  if (Array.isArray(data.queue)) {
    queue.length = 0
    let dropped = 0

    for (const item of data.queue) {
      if (isQueued(item.videoId) || isActiveNonFallback(item.videoId)) {
        dropped++
        continue
      }
      queue.push(item)
    }

    if (dropped) log.warn(`dropped ${dropped} duplicate item(s) while restoring the queue`)
  }
}

// Forgets the Channel Points redemption of every queued and current track (they stay as plain tracks). Returns how many there were
export function detachChannelPointsRedemptions(): number {
  let detached = 0

  playing.update(() => {
    for (const item of [currentSong, ...queue]) {
      if (item?.channelPointsRedemption) {
        delete item.channelPointsRedemption
        detached++
      }
    }
  })

  return detached
}

export function getQueue(): QueueItem[] {
  return [...queue]
}

export function getCurrent(): QueueItem | null {
  return currentSong
}

// Dequeues the next playable track and makes it the current one, in one state change (saved and announced
// once). Blocked tracks are closed on the way. Returns null when no playable track is left; whatever plays
// then stays the current one until the caller decides what follows
export function takeNextPlayable(): QueueItem | null {
  const closedOnTheWay: QueueItem[] = []
  const taken: QueueItem[] = []

  playing.update(() => {
    for (;;) {
      const candidate = queue.shift()
      if (!candidate) break
      if (isBlocked(candidate.videoId)) {
        closedOnTheWay.push(candidate)
        continue
      }
      candidate.playId = ++playCounter
      currentSong = candidate
      taken.push(candidate)
      break
    }
  })

  for (const item of closedOnTheWay) {
    log.log(`skipped blocked track in queue: "${item.title}"`)
    finishItem(item, { code: 'BLOCKED' })
  }

  const next = taken[0] ?? null
  if (next) log.log(`moved to next: "${next.title}"`)

  return next
}

export type AddOptions = {
  // an admin request (from this computer): neither the content filters nor the request limits apply
  bypassFilters?: boolean
  channelPointsRedemption?: QueueItem['channelPointsRedemption']
  // set for the tracks the playlist itself queues: they count as nobody's request
  isFallback?: boolean
}

// The refusals a new track can meet at the door, each in its own code, so every path that adds one answers
// the same way (the search filters out candidates by the same predicates before they are ever looked at)
export function assertCanRequestSong(requestedBy: string, { bypassFilters = false }: AddOptions = {}): void {
  const config = getConfig()

  // blocked tracks do not occupy places: they are closed when their turn comes
  const playable = queue.filter((item) => !isBlocked(item.videoId)).length
  if (currentSong !== null && playable >= config.maxQueueSize) {
    throw new AppError('QUEUE_FULL')
  }

  if (bypassFilters) return

  const activeCount = getUserActiveCount(requestedBy)
  if (config.maxRequestsPerUser > 0 && activeCount >= config.maxRequestsPerUser) {
    throw new AppError('USER_LIMIT', undefined, { count: config.maxRequestsPerUser })
  }
}

export function assertNotDuplicate(videoId: string): void {
  if (isDuplicate(videoId)) {
    throw new AppError('DUPLICATE')
  }
}

export function assertNotBlocked(videoId: string): void {
  if (isBlocked(videoId)) {
    throw new AppError('BLOCKED')
  }
}

export function assertCanAddSong(song: Song, requestedBy: string, options: AddOptions = {}): void {
  assertNotBlocked(song.videoId)
  assertNotDuplicate(song.videoId)
  assertCanRequestSong(requestedBy, options)
}

export function addSong(song: Song, requestedBy: string, options: AddOptions = {}): { item: QueueItem; started: boolean } {
  assertCanAddSong(song, requestedBy, options)

  const item: QueueItem = {
    ...song,
    requestedBy,
    ...(options.isFallback ? { isFallback: true } : {}),
    ...(options.channelPointsRedemption ? { channelPointsRedemption: options.channelPointsRedemption } : {})
  }
  const started = currentSong === null

  if (started) {
    setCurrent(item)
  } else {
    playing.update(() => {
      queue.push(item)
    })
    log.log(`added "${song.title}" at position ${queue.length}`)
  }

  return { item, started }
}

export function setCurrent(item: QueueItem | null): void {
  const previous = currentSong

  if (item?.videoId !== previous?.videoId) {
    log.log(item ? `now playing "${item.title}"` : 'nothing is playing')
  }

  playing.update(() => {
    if (item === null) {
      currentSong = null
    } else {
      item.playId = ++playCounter
      currentSong = item
    }
  })
}

export function removeByVideoId(videoId: string): QueueItem | null {
  return removeAt(queue.findIndex((item) => item.videoId === videoId))
}

function removeAt(index: number): QueueItem | null {
  if (index < 0 || index >= queue.length) {
    return null
  }

  let removed: QueueItem | undefined

  playing.update(() => {
    const [item] = queue.splice(index, 1)
    removed = item

    if (item) {
      log.log(`removed "${item.title}" at position ${index + 1}`)
      finishItem(item, { code: 'TRACK_REMOVED' })
    }
  })

  return removed ?? null
}

export function clearQueue(): QueueItem[] {
  let cleared: QueueItem[] = []

  playing.update(() => {
    cleared = [...queue]
    queue.length = 0
    for (const item of cleared) finishItem(item, { code: 'QUEUE_CLEARED' })
  })

  log.log(`cleared ${cleared.length} songs`)

  return cleared
}
