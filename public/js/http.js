export class ApiError extends Error {
  constructor(message, { status, code, params, cause } = {}) {
    super(message, { cause })
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.params = params
  }
}

// a request that gets no answer for this long is a failed one: a read that never ends would also stop its topic from ever being read again
const REQUEST_TIMEOUT_MS = 15_000

// the caller's signal and the timeout together: a page that stops must not wait for its answer either
const timeoutSignal = (signal) =>
  signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS)

/**
 * How the pages (the panel and the overlay) talk to the server: the `data` of the reply, or an ApiError.
 * The error has the `status`, `code` and `params` the server gave, and no status at all when the server could not be reached.
 */
export async function request(url, options = {}) {
  let response

  try {
    response = await fetch(url, {
      ...options,
      signal: timeoutSignal(options.signal),
      headers: {
        ...(options.body !== undefined && { 'Content-Type': 'application/json' }),
        ...options.headers
      }
    })
  } catch (cause) {
    // fetch rejects only when the server cannot be reached at all, or the request was given up on
    throw new ApiError('Network error', { code: 'NETWORK_ERROR', cause })
  }

  let body = null

  try {
    body = await response.json()
  } catch {
    // Empty/non-JSON response
  }

  if (!response.ok) {
    throw new ApiError(body?.error || `Request failed: ${response.status}`, {
      status: response.status,
      code: body?.code,
      params: body?.params
    })
  }

  return body?.data ?? null
}
