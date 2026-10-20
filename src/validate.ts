import type { NextFunction, Request, Response } from 'express'
import { AppError } from './types.js'
import { isValidPlaylistId, isValidVideoId, parsePlaylistId } from './youtube/url.js'

// The shared request rules, so two routes that take the same kind of input cannot drift apart:
// every route with a `:videoId` param goes through validateVideoIdParam, every query through checkQuery

// One home for the input caps, so a limit cannot drift between the routes, the chat and the rewards
export const INPUT_LIMITS = {
  queryMin: 2,
  queryMax: 200,
  requesterName: 50,
  blocklistTitle: 200,
  chatMessage: 500,
  rewardTitle: 45,
  rewardPrompt: 200
} as const

export function checkVideoId(value: unknown): asserts value is string {
  if (!isValidVideoId(value)) throw new AppError('INVALID_VIDEO_ID')
}

export function checkPlaylistId(value: unknown): void {
  if (!isValidPlaylistId(value)) throw new AppError('INVALID_PLAYLIST_ID')
}

// "a valid playlist ID or URL": the one rule for the routes that accept either form, which return the parsed id
export function checkPlaylistIdOrUrl(value: unknown): string {
  const id = typeof value === 'string' ? parsePlaylistId(value) : null
  if (id === null) throw new AppError('INVALID_PLAYLIST_ID')
  return id
}

export function checkQuery(value: unknown): string {
  const query = typeof value === 'string' ? value.trim() : ''

  if (query.length > INPUT_LIMITS.queryMax) throw new AppError('INVALID_QUERY_RANGE')
  if (query.length < INPUT_LIMITS.queryMin) throw new AppError('INVALID_QUERY')
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
