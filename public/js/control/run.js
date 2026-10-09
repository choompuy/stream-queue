import { t } from '../i18n.js'
import { translateErrorCode } from '../shared.js'
import { ApiError } from './api.js'
import { log } from './log.js'
import { toastError } from './toast.js'
import { withLoading } from './ui.js'

export function errorMessage(error) {
  return translateErrorCode(t, error?.code, error?.params, error?.message || String(error))
}

export function run(label, action, { button = null, silent = false, onError = null } = {}) {
  const execute = async () => {
    try {
      return await action()
    } catch (error) {
      log(`Error ${label}:`, error)
      if (!silent) toastError(error instanceof ApiError ? errorMessage(error) : t('api.errors.unexpectedError'))
      await onError?.(error)
      return undefined
    }
  }

  return button ? withLoading(button, execute) : execute()
}
