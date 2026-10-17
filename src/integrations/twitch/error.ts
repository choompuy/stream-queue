import { AppError } from '../../types.js'

export function normalizeTwitchError(error: unknown): AppError {
  if (error instanceof AppError) return error

  if (error instanceof Error) {
    // Network errors (no connection, timeout, DNS failure)
    return new AppError('TWITCH_NETWORK_ERROR', error.message, { transient: 1 })
  }

  return new AppError('TWITCH_UNKNOWN_ERROR', String(error))
}
