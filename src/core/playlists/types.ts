export type FallbackPlaylist = {
  playlistId: string | null
  enabled: boolean
  shuffle: boolean
  repeat: boolean
}

export type FallbackEnqueueResponse = { song: any; state: any }
export type FallbackStateResponse = FallbackPlaylist & {
  lastRefreshedAt: number | null
  upNext: any[]
  sourceCount: number
  activeVideoId: string | null
}