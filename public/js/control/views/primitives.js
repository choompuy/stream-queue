import { escapeHtml } from '../../shared.js'
import { BLOCK_ICON, MORE_ICON, UNBLOCK_ICON } from '../../icons.js'
import { t } from '../../i18n.js'

/**
 * The one way a row is written: a tagged template. Every value it puts into the markup is escaped - a title that
 * comes from a viewer is always text - except a value that is markup itself: the result of html`` (or a list of
 * them), assembled by this file or by a row that follows the same rule. The result is an { html } value, so it can
 * be nested into another template without being escaped a second time.
 */
export function html(strings, ...values) {
  let markup = ''
  strings.forEach((chunk, index) => {
    markup += chunk
    if (index < values.length) markup += toMarkup(values[index])
  })

  return { html: markup }
}

const toMarkup = (value) => {
  if (value == null || value === false || value === true) return ''
  // markup that is empty (an html`` of a condition that is not met) is still markup, and not a thing to print as [object Object]
  if (typeof value?.html === 'string') return value.html
  if (Array.isArray(value)) return value.map(toMarkup).join('')
  return escapeHtml(String(value))
}

/** Markup that is already what it must be where it is put in: an icon, or an attribute list built by this file */
export const raw = (string) => ({ html: String(string) })

/**
 * A list of rows that keeps its elements. A row is keyed by what it is (its video, its playlist), and a row whose
 * markup did not change keeps its element: an open menu, a focus or a hover survives a change somewhere else in the
 * list. The rows that changed are built anew, and the list is put in order without taking the rows that stay out of
 * the document. `renderRow(item, index)` returns the markup of a row (html``); `rowKey(item, index)` says what the
 * row is, and must not name two rows of one list the same.
 */
export function createListView(wrapper, { renderRow, rowKey }) {
  const list = wrapper.querySelector('.row-list')

  // the rows that are drawn: their markup and their element, by their key
  const drawn = new Map()

  function setEmpty(isEmpty) {
    wrapper.classList.toggle('is-empty', isEmpty)
  }

  function render(items = []) {
    setEmpty(items.length === 0)

    const next = new Map()
    const elements = []

    items.forEach((item, index) => {
      const key = rowKey(item, index)
      const markup = renderRow(item, index).html
      const previous = key === undefined ? undefined : drawn.get(key)

      if (previous && previous.html === markup && !next.has(key)) {
        next.set(key, previous)
        elements.push(previous.element)
        return
      }

      const template = document.createElement('template')
      template.innerHTML = markup
      const element = template.content.firstElementChild
      if (key !== undefined && !next.has(key)) next.set(key, { html: markup, element })
      elements.push(element)
    })

    drawn.clear()
    next.forEach((value, key) => drawn.set(key, value))

    // the rows that stay keep their place in the document; the ones that go are taken out after
    let anchor = list.firstChild
    for (const element of elements) {
      if (element === anchor) {
        anchor = anchor.nextSibling
        continue
      }
      list.insertBefore(element, anchor)
    }
    while (anchor) {
      const stale = anchor
      anchor = anchor.nextSibling
      stale.remove()
    }
  }

  function clear() {
    drawn.clear()
    setEmpty(true)
    list.replaceChildren()
  }

  return { render, clear, list, wrapper }
}

const toKebab = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

/** { videoId: 'x', title: 'y' } -> ` data-video-id="x" data-title="y"` (values are escaped) */
export function dataAttributes(data = {}) {
  return raw(
    Object.entries(data)
      .map(([name, value]) => ` data-${toKebab(name)}="${escapeHtml(value)}"`)
      .join('')
  )
}

export function row({ index, thumbnail, title, subtitle, extra, meta = '', actions = '', className = '', attributes = '' }) {
  return html`
    <div class="row-item ${className}"${attributes} role="listitem">
      ${index != null ? html`<span class="row-index text-sm text-secondary text-bold">${index}</span>` : ''}
      ${thumbnail ? html`<img src="${thumbnail}" class="thumbnail" alt="" loading="lazy">` : ''}
      <div class="column-info">
        <div class="text-sm text-primary truncate">${title}</div>
        ${subtitle ? html`<div class="text-xs text-secondary truncate">${subtitle}</div>` : ''}
      </div>
      ${extra}
      ${meta ? html`<span class="text-sm text-secondary">${meta}</span>` : ''}
      ${actions}
    </div>
  `
}

/** items: [{ action, data?, icon?, label, danger? }] */
export function rowMenu(items) {
  return html`
    <div class="row-menu">
      <button
        class="btn btn-sm btn-icon"
        data-action="toggle-menu"
        aria-haspopup="menu"
        aria-expanded="false"
        aria-label="${t('common.more')}"
        title="${t('common.more')}"
      >
        ${raw(MORE_ICON())}
      </button>
      <div class="row-menu-dropdown hidden" role="menu">
        ${items.map(
          (item) => html`
            <button class="row-menu-item btn btn-sm btn-secondary${item.danger ? ' btn-danger' : ''}" role="menuitem" data-action="${item.action}"${dataAttributes(item.data)}>
              <span>${item.label}</span>
              <span class="row-menu-icon">${item.icon ? raw(item.icon(20)) : ''}</span>
            </button>
          `
        )}
      </div>
    </div>
  `
}

export const statusPill = (label, status) => html`<span class="text-xs text-bold status-pill ${status}">${label}</span>`

export const blockTrackItem = (videoId, title) => ({
  action: 'block-track',
  data: { videoId, title },
  icon: BLOCK_ICON,
  label: t('blocklist.block'),
  danger: true
})

export const unblockTrackItem = (videoId) => html`
  <button
    class="btn btn-sm btn-icon"
    data-action="unblock-track"
    data-video-id="${videoId}"
    title="${t('blocklist.unblock')}"
  >
    ${raw(UNBLOCK_ICON())}
  </button>
`
