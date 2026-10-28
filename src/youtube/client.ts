import { getYoutubeApiKey } from '../secrets.js'
import { describeError } from '../logger.js'
import { AppError } from '../types.js'
import { VideoItem } from './types.js'
import { isQuotaExhausted, markQuotaExhausted } from './cache.js'
import { isPlain } from '../persist.js'
import { VIDEO_DETAILS_FIELDS, VIDEO_DETAILS_PART } from './filters.js'
import { fetchWithTimeout, retryableTransport } from '../web-fetch.js'

type YouTubeErrorResponse = {
  error?: {
    code?: number
    errors?: Array<{ reason?: string }>
    message?: string
  }
}

const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 500

function buildUrl(path: string, params: Record<string, string>, key: string): URL {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`)
  for (const [name, value] of Object.entries({ ...params, key })) url.searchParams.set(name, value)
  return url
}

// The quota is its own error: the flag markQuotaExhausted() raises keeps every further request from
// spending its attempts on an answer that will not change today
function youtubeError(data: YouTubeErrorResponse, status: number): AppError {
  if (data.error?.errors?.[0]?.reason === 'quotaExceeded') {
    markQuotaExhausted()
    return new AppError('YOUTUBE_QUOTA')
  }

  return new AppError('YOUTUBE_ERROR', data.error?.message || `YouTube API error ${status}`)
}

export async function youtube<T>(path: string, params: Record<string, string>, { attempts = MAX_ATTEMPTS }: { attempts?: number } = {}): Promise<T> {
  const youtubeApiKey = getYoutubeApiKey()

  if (!youtubeApiKey) throw new AppError('NO_API_KEY')
  if (isQuotaExhausted()) throw new AppError('YOUTUBE_QUOTA')

  // a timeout, a network error, a 429 and a 5xx are tried again (with growing pauses) while attempts are left
  let response: Response
  try {
    response = await fetchWithTimeout(buildUrl(path, params, youtubeApiKey), undefined, 10_000, {
      attempts,
      delayMs: (attempt) => RETRY_DELAY_MS * attempt,
      shouldRetry: retryableTransport
    })
  } catch (error) {
    throw new AppError('YOUTUBE_ERROR', `YouTube API is unreachable: ${describeError(error)}`)
  }

  // an error page is not always JSON, and a 200 is not always an object either: the caller maps the
  // answer right after, so the promise of an AppError holds for a malformed body as well
  const data = (await response.json().catch(() => ({}))) as T & YouTubeErrorResponse

  if (!isPlain(data)) throw new AppError('YOUTUBE_ERROR', 'YouTube API returned a malformed response')
  if (!response.ok) throw youtubeError(data, response.status)

  return data
}

const BATCH_SIZE = 50

export async function fetchVideos(ids: string[]): Promise<VideoItem[]> {
  const found = new Map<string, VideoItem>()

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const { items } = await youtube<{ items?: VideoItem[] }>('videos', { part: VIDEO_DETAILS_PART, fields: VIDEO_DETAILS_FIELDS, id: ids.slice(i, i + BATCH_SIZE).join(',') })
    for (const video of items ?? []) found.set(video.id, video)
  }

  // videos.list answers in no guaranteed order: the caller's order (search relevance, playlist position) is kept
  return ids.flatMap((id) => found.get(id) ?? [])
}
