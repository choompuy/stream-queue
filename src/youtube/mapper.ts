import { Song } from '../types.js'
import { VideoItem } from './types.js'
import { isoDurationToSeconds } from './scoring.js'

export function videoToSong(video: VideoItem): Song {
  return {
    videoId: video.id,
    title: video.snippet?.title ?? 'Unknown title',
    channelTitle: video.snippet?.channelTitle ?? 'Unknown channel',
    thumbnail: video.snippet?.thumbnails?.medium?.url ?? '',
    duration: isoDurationToSeconds(video.contentDetails?.duration),
    views: Number(video.statistics?.viewCount ?? 0),
    url: `https://www.youtube.com/watch?v=${video.id}`
  }
}
