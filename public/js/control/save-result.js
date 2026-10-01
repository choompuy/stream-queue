import { setFieldState } from '../shared.js'
import { t } from '../i18n.js'
import { toastError, toastSuccess } from './toast.js'

/**
 * Shows the outcome of a partial save on the fields and in one toast.
 * entries: { input, path, changed } - `path` is how the server names the field in `rejected`,
 * `changed` says whether the value sent differs from the one that was stored before.
 * Refused -> red, stored with a new value -> green, unchanged -> nothing to show
 * `successToast: false` keeps the fields' colours but skips the green toast, for a caller that has already
 * shown its own (worse) news - the toast about refused fields is always shown
 */
export function reportSaveResult(entries, rejected, successKey, { successToast = true } = {}) {
  let saved = 0
  let refused = 0

  for (const { input, path, changed } of entries) {
    const isRefused = rejected.includes(path)

    if (isRefused) refused++
    else if (changed) saved++

    setFieldState(input, isRefused ? 'error' : changed ? 'saved' : null)
  }

  if (refused === 0) {
    if (successToast) toastSuccess(t(successKey))
  }
  else toastError(t('toast.settingsPartiallySaved', { saved, rejected: refused }))
}

// yellow while the input differs from the stored value, cleared as soon as it matches again
export function trackChanges(input, isChanged) {
  if (!input) return

  const update = () => setFieldState(input, isChanged() ? 'changed' : null)

  input.addEventListener('input', update)
  input.addEventListener('change', update)
  input.addEventListener('focus', update)
}
