import { getVideoById, searchSongs, selectBestSong } from './youtube/index.js'
import { parseYouTubeUrl } from './youtube/url.js'
import { logRejection, logAcceptance } from './activity.js'
import { Song, AppError, AddedSong } from './types.js'
import { isBlocked } from './blocklist.js'
import { addSong, assertCanRequestSong, assertNotBlocked, assertNotDuplicate, getQueue, isDuplicate, type AddOptions } from './queue.js'
import { createLogger } from './logger.js'

const log = createLogger('REQUEST')

// Adds the song the query names to the queue, or throws the AppError that says why not (a duplicate,
// a limit, a filter, a bad URL); the activity journal entry is written on the way out, in one place
export async function requestSong(query: string, requestedBy: string, { bypassFilters = false, channelPointsRedemption }: AddOptions = {}): Promise<AddedSong> {
  let song: Song | null = null

  try {
    assertCanRequestSong(requestedBy, { bypassFilters })

    const { isYouTube, videoId } = parseYouTubeUrl(query)
    log.info(`[REQUEST] ${requestedBy} → ${videoId ? `YouTube URL: ${videoId}` : `Search: "${query}"`}`)

    if (isYouTube && !videoId) {
      throw new AppError('INVALID_YOUTUBE_URL')
    }

    if (videoId) {
      assertNotBlocked(videoId)
      assertNotDuplicate(videoId)
      song = await getVideoById(videoId, bypassFilters)
    } else {
      const songs = await searchSongs(query, bypassFilters)
      song = selectBestSong(songs, (candidate) => !isBlocked(candidate.videoId) && !isDuplicate(candidate.videoId))
    }

    if (!song) throw new AppError('SONG_NOT_FOUND')

    const { item, started } = addSong(song, requestedBy, { bypassFilters, channelPointsRedemption })

    log.info(`[ACCEPT] ${requestedBy} → "${song.title}" - ${started ? 'now playing' : 'queued'}`)
    logAcceptance(requestedBy, query, song.title, song.videoId)

    return { song: item, started, position: started ? 0 : getQueue().length }
  } catch (error) {
    // an expected refusal (duplicate, limit, filter) is routine and logRejection() writes it down; anything
    // else is a bug or an outage, and the handler that owns the request logs it once with its details
    logRejection(requestedBy, query, error instanceof AppError ? error.code : 'SERVER_ERROR', {
      title: song?.title ?? null,
      videoId: song?.videoId ?? null,
      reasonParams: error instanceof AppError ? error.params : undefined
    })
    throw error
  }
}
