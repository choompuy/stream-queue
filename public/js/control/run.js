import { t } from '../i18n.js'
import { translateErrorCode } from '../shared.js'
import { ApiError } from './api.js'
import { log } from './log.js'
import { toastError } from './toast.js'

export function errorMessage(error) {
  return translateErrorCode(t, error?.code, error?.params, error?.message || String(error))
}

// What the person is told about a failure: what the server said about it, or that something went wrong for what is not the server's
export function reportError(error) {
  toastError(error instanceof ApiError ? errorMessage(error) : t('api.errors.unexpectedError'))
}

// Everything that can fail on the panel goes through here: logged, shown, and never left to end up as an unhandled rejection.
// A failure gives undefined
export async function run(label, action, { silent = false } = {}) {
  try {
    return await action()
  } catch (error) {
    log(`Error ${label}:`, error)
    if (!silent) reportError(error)
    return undefined
  }
}
