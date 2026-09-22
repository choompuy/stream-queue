import { escapeHtml } from '../../shared.js'
import { BLOCK_ICON, MORE_ICON, PLUS_ICON, UNBLOCK_ICON } from '../../icons.js'
import { t } from '../../i18n.js'

export function createListView(wrapper, { renderRow, getKey, cache = true }) {
  const list = wrapper?.querySelector('.row-list')
  const empty = wrapper?.querySelector('.empty')

  if (!wrapper || !list || !empty) {
    return {
      render: () => {},
      clear: () => {},
      invalidate: () => {}
    }
  }

  let lastKey = null

  function setEmpty(isEmpty) {
    wrapper.classList.toggle('is-empty', isEmpty)
  }

  function render(items = []) {
    setEmpty(items.length === 0)
    const key = getKey ? getKey(items) : items.map((item) => item?.id ?? item?.videoId ?? item).join('|')

    if (cache && key === lastKey) return false

    lastKey = key

    if (!items.length) {
      list.innerHTML = ''
      return true
    }

    list.innerHTML = items.map((item, index) => renderRow(item, index)).join('')
    return true
  }

  function clear() {
    lastKey = null
    setEmpty(true)
    list.innerHTML = ''
  }

  function invalidate() {
    lastKey = null
  }

  return {
    render,
    clear,
    invalidate,
    list,
    empty,
    wrapper
  }
}

const toKebab = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

/** { videoId: 'x', title: 'y' } -> ` data-video-id="x" data-title="y"` (values are escaped) */
export function dataAttributes(data = {}) {
  return Object.entries(data)
    .map(([name, value]) => ` data-${toKebab(name)}="${escapeHtml(value)}"`)
    .join('')
}

export function row({ index, thumbnail, title, subtitle, meta = '', extra = '', actions = '', className = '', attributes = '' }) {
  return `
    <div class="row-item ${className}" ${attributes}>
      ${index != null ? `<span class="row-index text-sm text-secondary text-bold">${index}</span>` : ''}
      ${thumbnail ? `<img src="${escapeHtml(thumbnail)}" class="thumbnail" alt="${escapeHtml(title)}">` : ''}
      <div class="column-info">
        <div class="text-sm text-primary truncate">${escapeHtml(title)}</div>
        ${subtitle ? `<div class="text-xs text-secondary truncate">${escapeHtml(subtitle)}</div>` : ''}
      </div>
      ${extra}
      ${meta ? `<span class="text-sm text-secondary">${meta}</span>` : ''}
      ${actions}
    </div>
  `
}

/** items: [{ action, data?, icon?, label, danger? }] */
export function rowMenu(items) {
  return `
    <div class="row-menu">
      <button
        class="btn btn-sm btn-icon"
        data-action="toggle-menu"
        aria-haspopup="menu"
        aria-expanded="false"
        aria-label="${t('common.more')}"
        title="${t('common.more')}"
      >
        ${MORE_ICON()}
      </button>
      <div class="row-menu-dropdown hidden" role="menu">
        ${items
          .map(
            (item) => `
              <button class="row-menu-item btn btn-sm btn-secondary${item.danger ? ' btn-danger' : ''}" role="menuitem" data-action="${item.action}"${dataAttributes(item.data)}>
                <span>${item.label}</span>
                <span class="row-menu-icon">${item.icon ? item.icon(20) : ''}</span>
              </button>
            `
          )
          .join('')}
      </div>
    </div>
  `
}

export const statusPill = (label, status) => `<span class="text-xs text-bold status-pill ${escapeHtml(status)}">${label}</span>`

export const blockTrackItem = (videoId, title) => ({
  action: 'block-track',
  data: { videoId, title },
  icon: BLOCK_ICON,
  label: t('blocklist.block'),
  danger: true
})

export const unblockTrackItem = (videoId) => `
  <button
    class="btn btn-sm btn-icon"
    data-action="unblock-track"
    data-video-id="${escapeHtml(videoId)}"
    title="${t('blocklist.unblock')}"
  >
    ${UNBLOCK_ICON()}
  </button>
`
