import type { NextFunction, Request, Response } from 'express'
import { fail, failFromAppError, statusForCode } from './http.js'
import { AppError } from './types.js'
import { createLogger, describeError } from './logger.js'

const log = createLogger('SERVER')

type HttpError = Error & { status?: number; statusCode?: number; type?: string }

// The single exit for everything the routes throw: a thrown AppError becomes its own code and status,
// a malformed or oversized body its own, and anything else is a bug and stays anonymous to the client
export function errorHandler(err: HttpError, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err)
    return
  }

  if (err instanceof AppError) {
    if (statusForCode(err.code) >= 500) log.error(describeError(err))
    return failFromAppError(res, err)
  }
  if (err.type === 'entity.parse.failed') return fail(res, 'INVALID_JSON')
  if (err.type === 'entity.too.large') return fail(res, 'PAYLOAD_TOO_LARGE')

  const status = err.status ?? err.statusCode
  if (typeof status === 'number' && status >= 400 && status < 500) return fail(res, 'INVALID_REQUEST', undefined, status)

  log.error(describeError(err, true))
  fail(res, 'SERVER_ERROR')
}
