import { getSecrets } from '../../infra/secrets.js'
import { AppError } from '../../core/types.js'

export type PlaylistMeta = {
  id: string
  title: string
  thumbnail: string
  itemCount: number
}

type YouTubeErrorResponse = {
  error?: {
    code?: number
    errors?: Array<{ reason?: string }>
    message?: string
  }
}

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504])
const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 500

export const VIDEO_DETAILS_PART = 'snippet,contentDetails,statistics,status,topicDetails'

export class RequestNotSentError extends AppError {}

const isTimeout = (error: unknown): boolean => error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')

export async function youtube<T>(path: string, params: Record<string, string>, { attempts = MAX_ATTEMPTS }: { attempts?: number } = {}): Promise<T> {
  const { youtubeApiKey } = getSecrets()

  if (!youtubeApiKey) {
    throw new RequestNotSentError('NO_API_KEY', 'YouTube API key is not configured, add it in the control panel')
  }

  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`)

  for (const [key, value] of Object.entries({ ...params, key: youtubeApiKey })) {
    url.searchParams.set(key, value)
  }

  for (let attempt = 1; ; attempt++) {
    let response: Response
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    } catch (error) {
      if (attempt >= attempts) {
        const message = `YouTube API is unreachable: ${error instanceof Error ? error.message : error}`
        throw isTimeout(error) ? new AppError('YOUTUBE_ERROR', message) : new RequestNotSentError('YOUTUBE_ERROR', message)
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt))
      continue
    }

    if (RETRY_STATUSES.has(response.status) && attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt))
      continue
    }

    const data = (await response.json().catch(() => ({}))) as T & YouTubeErrorResponse

    if (!response.ok) {
      const reason = data.error?.errors?.[0]?.reason

      if (reason === 'quotaExceeded') {
        throw new AppError('YOUTUBE_QUOTA', 'YouTube API quota exceeded')
      }

      throw new AppError('YOUTUBE_ERROR', data.error?.message || `YouTube API error ${response.status}`)
    }

    return data
  }
}

export async function fetchPlaylistMeta(playlistId: string): Promise<PlaylistMeta | null> {
  const data = await youtube<{
    items: Array<{ id: string; snippet?: { title?: string; thumbnails?: { medium?: { url?: string } } }; contentDetails?: { itemCount?: number } }>
  }>('playlists', { part: 'snippet,contentDetails', id: playlistId })

  const item = data.items?.[0]
  if (!item) return null

  return {
    id: item.id,
    title: item.snippet?.title ?? 'Untitled playlist',
    thumbnail: item.snippet?.thumbnails?.medium?.url ?? '',
    itemCount: item.contentDetails?.itemCount ?? 0
  }
}
