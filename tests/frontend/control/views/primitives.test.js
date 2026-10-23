import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

// the rows are drawn into a real document: the elements they become are kept and reused
const dom = new JSDOM('<!doctype html><div id="wrapper"><div class="row-list" role="list"></div></div>')
globalThis.window = dom.window
globalThis.document = dom.window.document

const { initI18n } = await import('../../../../public/js/i18n.js')
await initI18n('en')
const { createListView, dataAttributes, html, raw, row, rowMenu, statusPill, unblockTrackItem } = await import(
  '../../../../public/js/control/views/primitives.js'
)

// the locale files are read by hand: initI18n would fetch them
const readLocale = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../public/locales/${name}.json`, import.meta.url)), 'utf8'))
globalThis.fetch = async () => ({ ok: true, json: async () => readLocale('en') })
await initI18n('en')

const asHtml = (markup) => markup.html

test('html', async (t) => {
  await t.test('escapes every value it puts in: a title from a viewer is text, wherever it lands', () => {
    assert.equal(asHtml(html`<div>${'<script>x</script>'}</div>`), '<div>&lt;script&gt;x&lt;/script&gt;</div>')
    assert.equal(asHtml(html`<a title="${'a"b'}">`), '<a title="a&quot;b">')
  })

  await t.test('puts a nested template (and a list of them) in as they are, and skips null, undefined and false', () => {
    assert.equal(asHtml(html`<div>${html`<b>${'x'}</b>`}</div>`), '<div><b>x</b></div>')
    assert.equal(asHtml(html`<div>${[html`<i>1</i>`, html`<i>2</i>`]}</div>`), '<div><i>1</i><i>2</i></div>')
    assert.equal(asHtml(html`<div>${null}${undefined}${false}${''}</div>`), '<div></div>')
  })

  await t.test('raw() is markup that is already what it must be: an icon, an attribute list', () => {
    assert.equal(asHtml(html`<span>${raw('<svg></svg>')}</span>`), '<span><svg></svg></span>')
  })
})

test('dataAttributes', async (t) => {
  await t.test('camelCase keys become kebab-case data- attributes', () => {
    assert.equal(asHtml(dataAttributes({ videoId: 'x', title: 'y' })), ' data-video-id="x" data-title="y"')
  })

  await t.test('escapes values', () => {
    assert.equal(asHtml(dataAttributes({ title: '<b>"hi"</b>' })), ' data-title="&lt;b&gt;&quot;hi&quot;&lt;/b&gt;"')
  })

  await t.test('no args', () => {
    assert.equal(asHtml(dataAttributes()), '')
  })
})

test('row', async (t) => {
  await t.test('escapes title/subtitle and includes thumbnail/meta/actions', () => {
    const markup = asHtml(
      row({
        index: 3,
        thumbnail: 'https://example.com/x.jpg',
        title: '<script>x</script>',
        subtitle: 'Some Channel',
        meta: '3:45',
        actions: raw('<button>x</button>')
      })
    )

    assert.ok(markup.includes('&lt;script&gt;x&lt;/script&gt;'))
    assert.ok(!markup.includes('<script>x</script>'))
    assert.ok(markup.includes('Some Channel'))
    assert.ok(markup.includes('3:45'))
    assert.ok(markup.includes('<button>x</button>'))
    assert.ok(markup.includes('>3<')) // 1-based index
    assert.ok(markup.includes('src="https://example.com/x.jpg"'))
    assert.ok(markup.includes('alt=""'), 'the caption is next to the picture: the picture says nothing itself')
    assert.ok(markup.includes('loading="lazy"'))
    assert.ok(markup.includes('role="listitem"'))
  })

  await t.test('omits the thumbnail/subtitle/index markup entirely when not given', () => {
    const markup = asHtml(row({ title: 'Just a title' }))
    assert.ok(!markup.includes('<img'))
    assert.ok(!markup.includes('row-index'))
  })
})

test('rowMenu', async (t) => {
  await t.test('renders one button per item with its label and danger class', () => {
    const markup = asHtml(
      rowMenu([
        { action: 'do-thing', label: 'Do thing' },
        { action: 'delete-thing', label: 'Delete', danger: true }
      ])
    )

    assert.ok(markup.includes('data-action="do-thing"'))
    assert.ok(markup.includes('>Do thing<'))
    assert.ok(markup.includes('data-action="delete-thing"'))
    assert.ok(/class="[^"]*btn-danger[^"]*"[^>]*data-action="delete-thing"/.test(markup))
  })

  await t.test('threads item.data through as data- attributes', () => {
    const markup = asHtml(rowMenu([{ action: 'unblock-track', label: 'Unblock', data: { videoId: 'abc' } }]))
    assert.ok(markup.includes('data-video-id="abc"'))
  })

  await t.test('escapes the label: a translation is text like any other', () => {
    const markup = asHtml(rowMenu([{ action: 'x', label: '<b>' }]))
    assert.ok(markup.includes('&lt;b&gt;'))
  })
})

test('statusPill', async (t) => {
  await t.test('escapes the label and the status', () => {
    assert.equal(
      asHtml(statusPill('<b>Blocked</b>', 'rejected"')),
      '<span class="text-xs text-bold status-pill rejected&quot;">&lt;b&gt;Blocked&lt;/b&gt;</span>'
    )
  })
})

test('unblockTrackItem', async (t) => {
  await t.test('escapes the video id into the data attribute', () => {
    const markup = asHtml(unblockTrackItem('"><script>'))
    assert.ok(markup.includes('data-action="unblock-track"'))
    assert.ok(!markup.includes('<script>'))
  })
})

// --- createListView -------------------------------------------------------

const makeWrapper = () => {
  const wrapper = document.createElement('div')
  wrapper.innerHTML = '<div class="row-list" role="list"></div>'
  return wrapper
}

test('createListView', async (t) => {
  await t.test('renders one row per item and toggles is-empty', () => {
    const wrapper = makeWrapper()
    const view = createListView(wrapper, { rowKey: (item) => item, renderRow: (item) => html`<div>${item}</div>` })

    view.render(['a', 'b'])
    assert.equal(wrapper.querySelector('.row-list').innerHTML, '<div>a</div><div>b</div>')
    assert.equal(wrapper.classList.contains('is-empty'), false)

    view.render([])
    assert.equal(wrapper.querySelector('.row-list').innerHTML, '')
    assert.equal(wrapper.classList.contains('is-empty'), true)
  })

  await t.test('a row whose markup did not change keeps its element: a change elsewhere leaves it alone', () => {
    const wrapper = makeWrapper()
    const view = createListView(wrapper, { rowKey: (item) => item, renderRow: (item) => html`<div class="r">${item}</div>` })

    view.render(['a', 'b'])
    const rowA = wrapper.querySelector('.row-list').children[0]
    const rowB = wrapper.querySelector('.row-list').children[1]

    // a change in the second row: the first keeps its element, the second is built anew
    view.render(['a', 'B'])
    const rows = wrapper.querySelector('.row-list').children
    assert.equal(rows[0], rowA, 'the unchanged row keeps its element')
    assert.notEqual(rows[1], rowB, 'the changed row is a new element')
  })

  await t.test('the element of a row follows the list: an open menu or a focus survives the reorder', () => {
    const wrapper = makeWrapper()
    const view = createListView(wrapper, { rowKey: (item) => item, renderRow: (item) => html`<div class="r">${item}</div>` })

    view.render(['a', 'b', 'c'])
    const [rowA, rowB, rowC] = [...wrapper.querySelector('.row-list').children]

    view.render(['c', 'a', 'b'])
    const rows = wrapper.querySelector('.row-list').children
    assert.equal(rows[0], rowC)
    assert.equal(rows[1], rowA)
    assert.equal(rows[2], rowB)
    assert.deepEqual([...rows].map((row) => row.textContent), ['c', 'a', 'b'])
  })

  await t.test('a row that disappears is gone, one that appears is drawn', () => {
    const wrapper = makeWrapper()
    const view = createListView(wrapper, { rowKey: (item) => item, renderRow: (item) => html`<div class="r">${item}</div>` })

    view.render(['a', 'b', 'c'])
    view.render(['b'])
    assert.deepEqual([...wrapper.querySelector('.row-list').children].map((row) => row.textContent), ['b'])

    view.render(['b', 'd'])
    assert.deepEqual([...wrapper.querySelector('.row-list').children].map((row) => row.textContent), ['b', 'd'])
  })

  await t.test('clear() empties the list, and the next render starts over', () => {
    const wrapper = makeWrapper()
    const view = createListView(wrapper, { rowKey: (item) => item, renderRow: (item) => html`<div class="r">${item}</div>` })

    view.render(['a'])
    const rowA = wrapper.querySelector('.row-list').children[0]
    view.clear()
    assert.equal(wrapper.querySelector('.row-list').children.length, 0)
    assert.equal(wrapper.classList.contains('is-empty'), true)

    view.render(['a'])
    assert.notEqual(wrapper.querySelector('.row-list').children[0], rowA)
  })
})

test('html', async (t) => {
  await t.test('markup that is empty is markup, not something to print: no [object Object]', () => {
    assert.equal(html`<p>${html``}</p>`.html, '<p></p>')
    assert.equal(html`<p>${raw('')}</p>`.html, '<p></p>')
    assert.equal(html`<p>${[html`a`, html``, html`b`]}</p>`.html, '<p>ab</p>')
    assert.equal(html`<p ${dataAttributes({})}></p>`.html, '<p ></p>')
  })
})
