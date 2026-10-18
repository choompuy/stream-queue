import type { NextFunction, Request, Response } from 'express'
import { AppError } from './types.js'
import { isValidPlaylistId, isValidVideoId } from './youtube/url.js'

// The shared request rules, so two routes that take the same kind of input cannot drift apart:
// every route with a `:videoId` param goes through validateVideoIdParam, every query through checkQuery

export function checkVideoId(value: unknown): void {
  if (!isValidVideoId(value)) throw new AppError('INVALID_VIDEO_ID', 'a valid videoId is required')
}

export function checkPlaylistId(value: unknown): void {
  if (!isValidPlaylistId(value)) throw new AppError('INVALID_PLAYLIST_ID', 'a valid playlist ID or URL is required')
}

export function checkQuery(value: unknown): string {
  const query = typeof value === 'string' ? value.trim() : ''

  if (query.length > 200) throw new AppError('INVALID_QUERY_RANGE', 'the query must be between 2 and 200 characters')
  if (query.length < 2) throw new AppError('INVALID_QUERY', 'the query must be at least 2 characters')
  return query
}

export function validateVideoIdParam(req: Request, _res: Response, next: NextFunction, value: unknown): void {
  try {
    checkVideoId(value)
    next()
  } catch (error) {
    next(error)
  }
}

export function validatePlaylistIdParam(req: Request, _res: Response, next: NextFunction, value: unknown): void {
  try {
    checkPlaylistId(value)
    next()
  } catch (error) {
    next(error)
  }
}
