import { t } from '../i18n.js'
import { translateErrorCode } from '../shared.js'
import { toastError, toastInfo } from './toast.js'

// What the server tells the panel is only shown: that it is worth telling, and what it is about, was decided there.
// A kind of notice that this panel does not know is left alone, so a newer server can tell more than an older panel shows
const NOTICES = {
  viewerRequest: ({ user, title }) => toastInfo(t('toast.viewerRequest', { user, title })),
  // the code is translated like any API error, so the text is the panel's language; the fallback covers a
  // code this panel has no translation for
  error: ({ code, params }) => toastError(translateErrorCode(t, code, params, t('api.errors.unexpectedError')))
}

export function showNotice(notice) {
  NOTICES[notice?.type]?.(notice)
}
