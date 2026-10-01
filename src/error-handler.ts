import type { NextFunction, Request, Response } from 'express'
import { fail, failFromError } from './http.js'
import { AppError } from './types.js'

// A cross-origin request from an origin the CORS policy does not allow
export class ForbiddenOriginError extends Error {
  readonly status = 403

  constructor() {
    super('Not allowed by CORS')
  }
}

type HttpError = Error & { status?: number; statusCode?: number; type?: string }

export function errorHandler(err: HttpError, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err)
    return
  }

  if (err instanceof AppError) return failFromError(res, err)
  if (err instanceof ForbiddenOriginError) return fail(res, 'this origin is not allowed', 'FORBIDDEN_ORIGIN', 403)
  if (err.type === 'entity.parse.failed') return fail(res, 'request body is not valid JSON', 'INVALID_JSON', 400)
  if (err.type === 'entity.too.large') return fail(res, 'request body is too large', 'PAYLOAD_TOO_LARGE', 413)

  const status = err.status ?? err.statusCode
  if (typeof status === 'number' && status >= 400 && status < 500) return fail(res, 'bad request', 'INVALID_REQUEST', status)

  console.log(`[SERVER] [ERROR] ${err.message}`)
  fail(res, 'internal server error', 'SERVER_ERROR', 500)
}
