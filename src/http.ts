import type { Response } from 'express'
import { AppError, HttpErrorCode, ApiOk, ApiError, ConfigUpdateResponse, FilterFailureReason } from './types.js'
import { getSettings } from './settings.js'
import { translateApiError } from './i18n.js'

export function ok<T extends object>(res: Response, data: T, status = 200): void {
  const body: ApiOk<T> = { success: true, data }
  res.status(status).json(body)
}

// A settings save is always a success: what the server refused is named in `rejected`, and the stored state is in
// `config` — the panel shows that result (form.js marks the refused fields). An error answer is reserved for what went
// wrong outside the form, so `data` never travels inside an error again
export function sendConfigUpdate<T extends object>(res: Response, config: T, rejected: string[]): void {
  ok<ConfigUpdateResponse<T>>(res, { config, rejected })
}

// the single place that knows which HTTP status an error code answers with; Record makes a missing row a
// compile error, so a new code cannot silently fall back to 500
const STATUS_BY_CODE: Record<HttpErrorCode, number> = {
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
  LOCAL_ONLY: 403,
  FORBIDDEN_ORIGIN: 403,
  INVALID_JSON: 400,
  PAYLOAD_TOO_LARGE: 413,
  INVALID_REQUEST: 400,
  SERVER_ERROR: 500,
  TOO_MANY_CONNECTIONS: 429,
  ...filterStatuses(
    [
      'NOT_MUSIC',
      'NOT_PUBLIC',
      'NOT_EMBEDDABLE',
      'AGE_RESTRICTED',
      'REGION_BLOCKED',
      'NOT_PLAYABLE',
      'IS_LIVE',
      'DURATION_OUT_OF_RANGE',
      'VIEWS_TOO_LOW'
    ],
    404
  )
}

// The single way to ask which status a code answers with; `fail` and the error logging agree through it
export function statusForCode(code: HttpErrorCode): number {
  return STATUS_BY_CODE[code]
}

// every code the API can answer with, taken from the table itself: the locale tests walk it
export const HTTP_ERROR_CODES: readonly HttpErrorCode[] = Object.keys(STATUS_BY_CODE) as HttpErrorCode[]

// the filter reasons all answer with the same status, so they stay one group
function filterStatuses(codes: readonly FilterFailureReason[], status: number): Record<FilterFailureReason, number> {
  return Object.fromEntries(codes.map((code) => [code, status])) as Record<FilterFailureReason, number>
}

// The one way an error leaves the app: the errorHandler passes the thrown AppError here, the few
// middleware that answer themselves (localOnly, hostCheck, the SSE connection limit) call it directly
export function fail(res: Response, code: HttpErrorCode, params?: Record<string, string | number>, status = statusForCode(code)): void {
  const locale = getSettings().locale
  const body: ApiError = { success: false, error: translateApiError(locale, code, params), code, params }
  res.status(status).json(body)
}

// AppError's message reaches the panel as the {{message}} parameter (TWITCH_API_ERROR carries Twitch's own text)
export function failFromAppError(res: Response, error: AppError): void {
  fail(res, error.code, error.toParams())
}
