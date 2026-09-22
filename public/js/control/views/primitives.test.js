import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createListView, dataAttributes, row, rowMenu, statusPill, unblockTrackItem } from './primitives.js'

test('dataAttributes', async (t) => {
  await t.test('camelCase keys become kebab-case data- attributes', () => {
    assert.equal(dataAttributes({ videoId: 'x', title: 'y' }), ' data-video-id="x" data-title="y"')
  })

  await t.test('escapes values', () => {
    assert.equal(dataAttributes({ title: '<b>"hi"</b>' }), ' data-title="&lt;b&gt;&quot;hi&quot;&lt;/b&gt;"')
  })

  await t.test('no args', () => {
    assert.equal(dataAttributes(), '')
  })
})

test('row', async (t) => {
  await t.test('escapes title/subtitle and includes thumbnail/meta/actions', () => {
    const html = row({
      index: 2,
      thumbnail: 'https://example.com/x.jpg',
      title: '<script>x</script>',
      subtitle: 'Some Channel',
      meta: '3:45',
      actions: '<button>x</button>'
    })

    assert.ok(html.includes('&lt;script&gt;x&lt;/script&gt;'))
    assert.ok(!html.includes('<script>x</script>'))
    assert.ok(html.includes('Some Channel'))
    assert.ok(html.includes('3:45'))
    assert.ok(html.includes('<button>x</button>'))
    assert.ok(html.includes('>3<')) // 1-based index
    assert.ok(html.includes('src="https://example.com/x.jpg"'))
  })

  await t.test('omits the thumbnail/subtitle/index markup entirely when not given', () => {
    const html = row({ title: 'Just a title' })
    assert.ok(!html.includes('<img'))
    assert.ok(!html.includes('row-index'))
  })
})

test('rowMenu', async (t) => {
  await t.test('renders one button per item with its label and danger class', () => {
    const html = rowMenu([
      { action: 'do-thing', label: 'Do thing' },
      { action: 'delete-thing', label: 'Delete', danger: true }
    ])

    assert.ok(html.includes('data-action="do-thing"'))
    assert.ok(html.includes('>Do thing<'))
    assert.ok(html.includes('data-action="delete-thing"'))
    assert.ok(/class="[^"]*btn-danger[^"]*"[^>]*data-action="delete-thing"/.test(html))
  })

  await t.test('threads item.data through as data- attributes', () => {
    const html = rowMenu([{ action: 'unblock-track', label: 'Unblock', data: { videoId: 'abc' } }])
    assert.ok(html.includes('data-video-id="abc"'))
  })
})

test('statusPill', async (t) => {
  await t.test('escapes the status but not the label', () => {
    assert.equal(statusPill('<b>Blocked</b>', 'rejected"'), '<span class="text-xs text-bold status-pill rejected&quot;"><b>Blocked</b></span>')
  })
})

test('unblockTrackItem', async (t) => {
  await t.test('escapes the video id into the data attribute', () => {
    const html = unblockTrackItem('"><script>')
    assert.ok(html.includes('data-action="unblock-track"'))
    assert.ok(!html.includes('<script>'))
  })
})

// --- createListView -------------------------------------------------------

function fakeClassList() {
  const classes = new Set()
  return {
    toggle(name, force) {
      const on = force ?? !classes.has(name)
      if (on) classes.add(name)
      else classes.delete(name)
    },
    contains: (name) => classes.has(name),
    has: (name) => classes.has(name)
  }
}

function fakeElement() {
  return { innerHTML: '', classList: fakeClassList() }
}

function fakeWrapper() {
  const list = fakeElement()
  const empty = fakeElement()
  return {
    classList: fakeClassList(),
    querySelector: (sel) => (sel === '.row-list' ? list : sel === '.empty' ? empty : null),
    list,
    empty
  }
}

test('createListView', async (t) => {
  await t.test('renders one row per item and toggles is-empty', () => {
    const wrapper = fakeWrapper()
    const view = createListView(wrapper, { renderRow: (item) => `<div>${item}</div>` })

    view.render(['a', 'b'])
    assert.equal(wrapper.list.innerHTML, '<div>a</div><div>b</div>')
    assert.equal(wrapper.classList.contains('is-empty'), false)

    view.render([])
    assert.equal(wrapper.list.innerHTML, '')
    assert.equal(wrapper.classList.contains('is-empty'), true)
  })

  await t.test('skips re-rendering when the key has not changed', () => {
    const wrapper = fakeWrapper()
    let renderCount = 0
    const view = createListView(wrapper, {
      renderRow: (item) => {
        renderCount++
        return `<div>${item}</div>`
      },
      getKey: (items) => items.join(',')
    })

    view.render(['a', 'b'])
    assert.equal(renderCount, 2)

    view.render(['a', 'b']) // same key, should not touch renderRow at all
    assert.equal(renderCount, 2)

    view.render(['a', 'c']) // different key
    assert.equal(renderCount, 4)
  })

  await t.test('invalidate() forces the next render through even with an unchanged key', () => {
    const wrapper = fakeWrapper()
    let renderCount = 0
    const view = createListView(wrapper, {
      renderRow: () => {
        renderCount++
        return '<div></div>'
      },
      getKey: () => 'same-key'
    })

    view.render(['a'])
    assert.equal(renderCount, 1)

    view.invalidate()
    view.render(['a'])
    assert.equal(renderCount, 2)
  })

  await t.test('missing wrapper/list/empty degrades to safe no-ops instead of throwing', () => {
    const view = createListView(null, { renderRow: () => '<div></div>' })
    assert.doesNotThrow(() => view.render(['a']))
    assert.doesNotThrow(() => view.clear())
    assert.doesNotThrow(() => view.invalidate())
  })
})
