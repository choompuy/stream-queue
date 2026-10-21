import { setTimeout as sleep } from 'node:timers/promises'

export type RetryRule = {
  attempts: number
  // the pause before the next attempt: the caller decides how fast the delay grows
  delayMs: (attempt: number) => number
  shouldRetry: (failure: { error?: unknown; status?: number }) => boolean
}

/**
 * One retry rule for the transports: what can pass by itself - a network error, a timeout (they arrive
 * as the error half of the failure), a 429, a 5xx. What a failure MEANS stays with the caller
 * (a refused request is still an error to answer with); only the "worth trying again" question is shared.
 */
export const retryableTransport = (failure: { error?: unknown; status?: number }): boolean =>
  failure.error !== undefined || failure.status === 429 || (typeof failure.status === 'number' && failure.status >= 500)

/**
 * The one fetch skeleton: a request with a timeout, retried while attempts are left and the rule says
 * the failure can pass by itself. Only the transport lives here; parsing the answer and naming a
 * failure stay with the caller (the YouTube client has its quota, the Twitch layer its own codes).
 */
export async function fetchWithTimeout(url: string | URL, init: RequestInit | undefined, timeoutMs: number, retry?: RetryRule): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
      if (retry && attempt < retry.attempts && retry.shouldRetry({ status: response.status })) {
        // the answer is about to be thrown away: cancel its unread body, or the connection is held until the timeout
        await response.body?.cancel().catch(() => {})
        await sleep(retry.delayMs(attempt))
        continue
      }
      return response
    } catch (error) {
      if (retry && attempt < retry.attempts && retry.shouldRetry({ error })) {
        await sleep(retry.delayMs(attempt))
        continue
      }
      throw error
    }
  }
}
