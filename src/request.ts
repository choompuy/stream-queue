import { getVideoById, searchSongs, selectBestSong } from './youtube/index.js'
import { parseYouTubeUrl } from './youtube/url.js'
import { logRejection, logAcceptance } from './activity.js'
import { Song, AppError, AddedSong } from './types.js'
import { isBlocked } from './blocklist.js'
import { addSong, assertCanRequestSong, assertNotBlocked, assertNotDuplicate, getQueue, isDuplicate, type AddOptions } from './queue.js'
import { createLogger } from './logger.js'

const log = createLogger('REQUEST')

// Resolves what the query names into the song to add: a YouTube URL is taken apart, anything else is searched
// with the first allowed result used. null when nothing playable came back
async function resolveSong(query: string, requestedBy: string, bypassFilters: boolean): Promise<Song | null> {
  const { isYouTube, videoId } = parseYouTubeUrl(query)
  log.info(`[REQUEST] ${requestedBy} → ${videoId ? `YouTube URL: ${videoId}` : `Search: "${query}"`}`)

  if (isYouTube && !videoId) {
    throw new AppError('INVALID_YOUTUBE_URL')
  }

  if (videoId) {
    assertNotBlocked(videoId)
    assertNotDuplicate(videoId)
    return getVideoById(videoId, bypassFilters)
  }

  const songs = await searchSongs(query, bypassFilters)
  return selectBestSong(songs, (candidate) => !isBlocked(candidate.videoId) && !isDuplicate(candidate.videoId))
}

// The accepted request: the song joins the queue, the journal and the answer say where it landed
function acceptSong(song: Song, requestedBy: string, query: string, options: AddOptions): AddedSong {
  const { item, started } = addSong(song, requestedBy, options)

  log.info(`[ACCEPT] ${requestedBy} → "${song.title}" - ${started ? 'now playing' : 'queued'}`)
  logAcceptance(requestedBy, query, song.title, song.videoId)

  return { song: item, started, position: started ? 0 : getQueue().length }
}

// The journal entry of a refusal: the code of an AppError, SERVER_ERROR for anything else, and whatever
// of the song was already known when the refusal came
function rejectRequest(query: string, requestedBy: string, song: Song | null, error: unknown): void {
  logRejection(requestedBy, query, error instanceof AppError ? error.code : 'SERVER_ERROR', {
    title: song?.title ?? null,
    videoId: song?.videoId ?? null,
    reasonParams: error instanceof AppError ? error.params : undefined
  })
}

// Adds the song the query names to the queue, or throws the AppError that says why not (a duplicate,
// a limit, a filter, a bad URL); the activity journal entry is written on the way out, in one place
export async function requestSong(query: string, requestedBy: string, { bypassFilters = false, channelPointsRedemption }: AddOptions = {}): Promise<AddedSong> {
  let song: Song | null = null

  try {
    assertCanRequestSong(requestedBy, { bypassFilters })

    song = await resolveSong(query, requestedBy, bypassFilters)
    if (!song) throw new AppError('SONG_NOT_FOUND')

    return acceptSong(song, requestedBy, query, { bypassFilters, channelPointsRedemption })
  } catch (error) {
    // an expected refusal (duplicate, limit, filter) is routine and logRejection() writes it down; anything
    // else is a bug or an outage, and the handler that owns the request logs it once with its details
    rejectRequest(query, requestedBy, song, error)
    throw error
  }
}
