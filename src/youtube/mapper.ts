import { Song } from '../types.js'
import { VideoItem, Snippet } from './types.js'
import { isoDurationToSeconds } from './utils.js'
import { youtube } from './client.js'

export type PlaylistMeta = {
  id: string
  title: string
  thumbnail: string
  itemCount: number
}

export type PlaylistFetchResult = { songs: Song[]; truncated: boolean; itemCount: number | null }

// A missing snippet field is stored as an empty string: the panel puts its own localized placeholder on top
// of an empty title (common.unknownTitle in the locales), so no fixed-language text travels with the data
export function videoToSong(video: VideoItem): Song {
  return {
    videoId: video.id,
    title: video.snippet?.title ?? '',
    channelTitle: video.snippet?.channelTitle ?? '',
    thumbnail: video.snippet?.thumbnails?.medium?.url ?? '',
    duration: isoDurationToSeconds(video.contentDetails?.duration),
    views: Number(video.statistics?.viewCount ?? 0),
    url: `https://www.youtube.com/watch?v=${video.id}`
  }
}

export async function fetchPlaylistMeta(playlistId: string): Promise<PlaylistMeta | null> {
  const data = await youtube<{
    items?: Array<{ id: string; snippet?: Snippet; contentDetails?: { itemCount?: number } }>
  }>('playlists', { part: 'snippet,contentDetails', fields: 'items(id,snippet(title,thumbnails/medium/url),contentDetails/itemCount)', id: playlistId })

  const item = data.items?.[0]
  if (!item) return null

  return {
    id: item.id,
    title: item.snippet?.title ?? '',
    thumbnail: item.snippet?.thumbnails?.medium?.url ?? '',
    itemCount: item.contentDetails?.itemCount ?? 0
  }
}
