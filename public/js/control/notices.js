import { t } from '../i18n.js'
import { toastInfo } from './toast.js'

// What the server tells the panel is only shown: that it is worth telling, and what it is about, was decided there.
// A kind of notice that this panel does not know is left alone, so a newer server can tell more than an older panel shows
const NOTICES = {
  viewerRequest: ({ user, title }) => toastInfo(t('toast.viewerRequest', { user, title }))
}

export function showNotice(notice) {
  NOTICES[notice?.type]?.(notice)
}
