import { Response } from 'express-serve-static-core'
import { AppError, AppErrorCode, ApiOk, ApiError, ConfigUpdateResponse, FilterFailureReason } from './types.js'
import { getSettings } from './settings.js'
import { translateApiError } from './i18n.js'

export function ok<T extends object>(res: Response, data: T, status = 200): void {
  const body: ApiOk<T> = { success: true, data }
  res.status(status).json(body)
}

export function sendConfigUpdate<T extends object>(res: Response, config: T, rejected: string[]): void {
  const data: ConfigUpdateResponse<T> = { config, rejected }

  if (rejected.length === 0) {
    ok(res, data)
    return
  }

  const params = { fields: rejected.join(', ') }
  const localized = translateApiError(getSettings().locale, 'INVALID_CONFIG', params)
  const body: ApiError & { data: ConfigUpdateResponse<T> } = {
    success: false,
    error: localized,
    code: 'INVALID_CONFIG',
    params,
    data
  }
  res.status(STATUS_BY_CODE.INVALID_CONFIG ?? 400).json(body)
}

// the single place that knows which HTTP status an error code answers with;
// the chat-only reasons (playback, track lifecycle) never appear here and fall back to 500
const STATUS_BY_CODE: Partial<Record<AppErrorCode, number>> = {
  DUPLICATE: 409,
  QUEUE_FULL: 409,
  USER_LIMIT: 409,
  BLOCKED: 409,
  YOUTUBE_QUOTA: 503,
  YOUTUBE_ERROR: 503,
  NO_API_KEY: 400,
  TWITCH_AUTH_ERROR: 400,
  TWITCH_REFRESH_ERROR: 401,
  TWITCH_NOT_CONNECTED: 400,
  TWITCH_API_ERROR: 502,
  TWITCH_NETWORK_ERROR: 502,
  TWITCH_UNKNOWN_ERROR: 500,
  INVALID_INPUT: 400,
  INVALID_QUERY: 400,
  INVALID_QUERY_RANGE: 400,
  INVALID_VIDEO_ID: 400,
  USERNAME_REQUIRED: 400,
  INVALID_YOUTUBE_URL: 400,
  SONG_NOT_FOUND: 404,
  QUEUE_ITEM_NOT_FOUND: 404,
  NOT_FOUND: 404,
  INVALID_PLAYLIST_ID: 400,
  PLAYLIST_NOT_FOUND: 404,
  INVALID_CONFIG: 400,
  LOCAL_ONLY: 403,
  FORBIDDEN_ORIGIN: 403,
  INVALID_JSON: 400,
  PAYLOAD_TOO_LARGE: 413,
  INVALID_REQUEST: 400,
  SERVER_ERROR: 500,
  ...filterStatuses(['NOT_MUSIC', 'NOT_PUBLIC', 'NOT_EMBEDDABLE', 'AGE_RESTRICTED', 'REGION_BLOCKED', 'NOT_PLAYABLE', 'IS_LIVE', 'IS_SHORT', 'DURATION_OUT_OF_RANGE', 'VIEWS_TOO_LOW'], 404)
}

function filterStatuses(codes: readonly FilterFailureReason[], status: number): Partial<Record<AppErrorCode, number>> {
  return Object.fromEntries(codes.map((code) => [code, status]))
}

// The one way an error leaves the app: the errorHandler passes the thrown AppError here, the few
// middleware that answer themselves (localOnly, hostCheck, the SSE connection limit) call it directly
export function fail(res: Response, code: AppErrorCode, params?: Record<string, string | number>, status = STATUS_BY_CODE[code] ?? 500): void {
  const locale = getSettings().locale
  const body: ApiError = { success: false, error: translateApiError(locale, code, params), code, params }
  res.status(status).json(body)
}

// AppError's message reaches the panel as the {{message}} parameter (TWITCH_API_ERROR carries Twitch's own text)
export function failFromAppError(res: Response, error: AppError): void {
  fail(res, error.code, { ...error.params, message: error.message })
}
