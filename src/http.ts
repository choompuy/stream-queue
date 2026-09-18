import { Response, Request, NextFunction, RequestHandler, ParamsDictionary } from 'express-serve-static-core'
import { AppError, AppErrorCode, ApiOk, ApiError } from './types.js'
import { getSettings } from './settings.js'
import { translateErrorCode } from './i18n.js'

export function ok<T extends object>(res: Response, data: T, status = 200): void {
  const body: ApiOk<T> = { success: true, ...data }
  res.status(status).json(body)
}

export function fail(res: Response, error: string, code: string, status: number, params?: Record<string, string | number>): void {
  const locale = getSettings().locale
  const localized = translateErrorCode(locale, code, params)
  const body: ApiError = { success: false, error: localized ?? error, code, params }
  res.status(status).json(body)
}

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  DUPLICATE: 409,
  QUEUE_FULL: 409,
  USER_LIMIT: 409,
  BLOCKED: 409,
  YOUTUBE_QUOTA: 503,
  YOUTUBE_ERROR: 503,
  NO_API_KEY: 400,
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
  fail(res, info.message, info.code, info.status, info.params)
}

export function asyncHandler<P = ParamsDictionary>(
  handler: (req: Request<P>, res: Response, next: NextFunction) => Promise<void>
): RequestHandler<P> {
  return (req, res, next) => {
    handler(req, res, next).catch(next)
  }
}
