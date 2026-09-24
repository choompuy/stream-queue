import type { QueueItem } from '../queue/types.js'

export type PlayerState = {
  current: QueueItem | null
  queue: QueueItem[]
  isPaused: boolean
}

export type StateResponse = PlayerState & { nextTrack: QueueItem | null }
export type PlayerActionResponse = StateResponse & { message: string }