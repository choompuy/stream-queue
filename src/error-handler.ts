import type { NextFunction, Request, Response } from 'express'
import { fail, failFromError } from './http.js'
import { AppError } from './types.js'
import { createLogger, describeError } from './logger.js'

const log = createLogger('SERVER')

type HttpError = Error & { status?: number; statusCode?: number; type?: string }

export function errorHandler(err: HttpError, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err)
    return
  }

  if (err instanceof AppError) return failFromError(res, err)
  if (err.type === 'entity.parse.failed') return fail(res, 'INVALID_JSON', 400)
  if (err.type === 'entity.too.large') return fail(res, 'PAYLOAD_TOO_LARGE', 413)

  const status = err.status ?? err.statusCode
  if (typeof status === 'number' && status >= 400 && status < 500) return fail(res, 'INVALID_REQUEST', status)

  log.error(describeError(err, true))
  fail(res, 'SERVER_ERROR', 500)
}
