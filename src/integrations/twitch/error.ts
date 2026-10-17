import { AppError } from '../../types.js'

// `transient: 1` on an error's params says the same attempt may work later (a lost connection, a login that
// could not be refreshed just now), so a retry is worth it. The literal lives here alone, and the error is
// rebuilt rather than mutated
export function markTransient(error: AppError): AppError {
  if (error.params?.transient === 1) return error
  return new AppError(error.code, error.message, { ...error.params, transient: 1 })
}

// fetch fails as a TypeError ("fetch failed", "terminated"), and a timeout as a DOMException named
// TimeoutError or AbortError: those are "no connection to Twitch". Any other Error is something else (a
// refusal, a bug of our own) and must not be reported as a missing connection
export function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
}

export function normalizeTwitchError(error: unknown): AppError {
  if (error instanceof AppError) return error

  if (error instanceof Error) {
    return isNetworkError(error)
      ? markTransient(new AppError('TWITCH_NETWORK_ERROR', error.message))
      : new AppError('TWITCH_UNKNOWN_ERROR', error.message)
  }

  return new AppError('TWITCH_UNKNOWN_ERROR', String(error))
}
