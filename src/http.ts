import { Response, Request, NextFunction, RequestHandler, ParamsDictionary } from 'express-serve-static-core'
import { AppError, AppErrorCode, ApiOk, ApiError, ApiErrorCode, ConfigUpdateResponse } from './types.js'
import { getSettings } from './settings.js'
import { translateErrorCode } from './i18n.js'

export function ok<T extends object>(res: Response, data: T, status = 200): void {
  const body: ApiOk<T> = { success: true, data }
  res.status(status).json(body)
}

export function fail(res: Response, error: string, code: ApiErrorCode, status: number, params?: Record<string, string | number>): void {
  const locale = getSettings().locale
  const localized = translateErrorCode(locale, code, params)
  const body: ApiError = { success: false, error: localized ?? error, code, params }
  res.status(status).json(body)
}

export function sendConfigUpdate<T extends object>(res: Response, config: T, rejected: string[]): void {
  const data: ConfigUpdateResponse<T> = { config, rejected }

  if (rejected.length === 0) {
    ok(res, data)
    return
  }

  const params = { fields: rejected.join(', ') }
  const localized = translateErrorCode(getSettings().locale, 'INVALID_CONFIG', params)
  const body: ApiError & { data: ConfigUpdateResponse<T> } = {
    success: false,
    error: localized ?? 'invalid config fields',
    code: 'INVALID_CONFIG',
    params,
    data
  }
  res.status(400).json(body)
}

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
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
  TWITCH_EVENTSUB_ERROR: 400,
  TWITCH_API_ERROR: 502,
  NOT_MUSIC: 404,
  NOT_EMBEDDABLE: 404,
  DURATION_OUT_OF_RANGE: 404,
  VIEWS_TOO_LOW: 404,
  REGION_BLOCKED: 404,
  NOT_PUBLIC: 404,
  AGE_RESTRICTED: 404,
  NOT_PLAYABLE: 404,
  IS_LIVE: 404,
  IS_SHORT: 404
}

export type ErrorInfo = { code: string; status: number; message: string; params?: Record<string, string | number> }

export function getErrorInfo(error: unknown): ErrorInfo {
  if (error instanceof AppError) {
    return { code: error.code, status: STATUS_BY_CODE[error.code], message: error.message, params: error.params }
  }

  console.error('[UNEXPECTED ERROR]', error)
  return { code: 'SERVER_ERROR', status: 500, message: 'internal server error' }
}

export function failFromError(res: Response, error: unknown): void {
  const info = getErrorInfo(error)
  fail(res, info.message, info.code as ApiErrorCode, info.status, info.params)
}

// same as failFromError, for callers that already have a structured { code, params } reason
// instead of the original thrown error (e.g. RequestSongResult's 'error' outcome)
export function failFromReason(res: Response, reason: { code: string; params?: Record<string, string | number> }): void {
  const status = STATUS_BY_CODE[reason.code as AppErrorCode] ?? 500
  fail(res, reason.code, reason.code as ApiErrorCode, status, reason.params)
}

export function asyncHandler<P = ParamsDictionary>(
  handler: (req: Request<P>, res: Response, next: NextFunction) => Promise<void>
): RequestHandler<P> {
  return (req, res, next) => {
    handler(req, res, next).catch(next)
  }
}
