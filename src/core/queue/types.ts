import type { Song } from '../../shared/types.js'

export type QueueItem = Song & {
  requestedBy: string
  isFallback?: boolean
}

export type AddedSong = {
  song: QueueItem
  started: boolean
  position: number
}

export type QueueRequestResponse = AddedSong & { state: any; message: string }
export type QueueRemoveResponse = { removed: QueueItem; state: any }