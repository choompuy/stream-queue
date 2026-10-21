import { getYoutubeApiKey } from '../secrets.js'
import { describeError } from '../logger.js'
import { AppError } from '../types.js'
import { VideoItem } from './types.js'
import { isQuotaExhausted, markQuotaExhausted } from './cache.js'
import { isPlain } from '../persist.js'
import { VIDEO_DETAILS_PART } from './filters.js'
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

export async function youtube<T>(path: string, params: Record<string, string>, { attempts = MAX_ATTEMPTS }: { attempts?: number } = {}): Promise<T> {
  const youtubeApiKey = getYoutubeApiKey()

  if (!youtubeApiKey) throw new AppError('NO_API_KEY')
  if (isQuotaExhausted()) throw new AppError('YOUTUBE_QUOTA')

  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`)

  for (const [key, value] of Object.entries({ ...params, key: youtubeApiKey })) {
    url.searchParams.set(key, value)
  }

  // a timeout, a network error, a 429 and a 5xx are tried again (with growing pauses) while attempts are left
  let response: Response
  try {
    response = await fetchWithTimeout(url, undefined, 10_000, {
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

  if (!response.ok) {
    const reason = data.error?.errors?.[0]?.reason

    if (reason === 'quotaExceeded') {
      markQuotaExhausted()
      throw new AppError('YOUTUBE_QUOTA')
    }

    throw new AppError('YOUTUBE_ERROR', data.error?.message || `YouTube API error ${response.status}`)
  }

  return data
}

const BATCH_SIZE = 50

export async function fetchVideos(ids: string[]): Promise<VideoItem[]> {
  const found = new Map<string, VideoItem>()

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const { items } = await youtube<{ items?: VideoItem[] }>('videos', { part: VIDEO_DETAILS_PART, id: ids.slice(i, i + BATCH_SIZE).join(',') })
    for (const video of items ?? []) found.set(video.id, video)
  }

  // videos.list answers in no guaranteed order: the caller's order (search relevance, playlist position) is kept
  return ids.flatMap((id) => found.get(id) ?? [])
}
