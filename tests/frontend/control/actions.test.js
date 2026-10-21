import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setupPanel, deferred } from './panel-env.js'

const panel = setupPanel()
mock.method(console, 'log', () => {})

const { initI18n, t: translate } = await import('../../../public/js/i18n.js')
await initI18n('en')
const { createActionRegistry, dispatchAction, ACTIONS } = await import('../../../public/js/control/actions.js')
const { views } = await import('../../../public/js/control/views/index.js')

const flush = () => new Promise((resolve) => setImmediate(resolve))
const clickEvent = () => new window.Event('click')

const CONTROL_DIR = fileURLToPath(new URL('../../../public/js/control', import.meta.url))
const sources = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? sources(join(dir, entry.name)) : entry.name.endsWith('.js') ? [readFileSync(join(dir, entry.name), 'utf8')] : []))

test('createActionRegistry', async (t) => {
  await t.test('puts the actions of every map in one registry', () => {
    const a = () => 'a'
    const b = () => 'b'

    const registry = createActionRegistry({ first: a }, { second: b })

    assert.equal(registry.first, a)
    assert.equal(registry.second, b)
  })

  await t.test('refuses a name that two maps both claim, instead of letting the later one win silently', () => {
    assert.throws(() => createActionRegistry({ skip: () => {} }, { skip: () => {} }), /Duplicate UI action "skip"/)
  })

  await t.test('has no inherited names: "constructor" is not an action', () => {
    assert.equal(createActionRegistry({}).constructor, undefined)
  })
})

test('dispatchAction', async (t) => {
  panel.route('POST /api/player/skip', {})
  panel.route('GET /api/state', { current: null })

  await t.test('runs the handler of the data-action, with the element and the event', async () => {
    const button = document.createElement('button')
    button.dataset.action = 'skip'

    await dispatchAction(button, new window.Event('click'))

    assert.deepEqual(panel.calls, ['POST /api/player/skip'])
  })

  await t.test('a button with data-confirm asks first: no leaves everything as it was, yes runs the action', async () => {
    const button = document.createElement('button')
    button.dataset.action = 'skip'
    button.dataset.confirm = 'queue.clearConfirm'
    panel.calls.length = 0

    globalThis.confirm = () => false
    assert.equal(dispatchAction(button, clickEvent()), undefined)
    assert.deepEqual(panel.calls, [])

    let asked = null
    globalThis.confirm = (question) => ((asked = question), true)
    await dispatchAction(button, clickEvent())

    assert.equal(asked, 'Clear entire queue?')
    assert.deepEqual(panel.calls, ['POST /api/player/skip'])
    globalThis.confirm = () => true
  })

  await t.test('a button whose action takes time stays disabled until it is over, and is enabled again after', async () => {
    const answer = deferred()
    panel.route('POST /api/player/skip', () => answer.promise)
    const button = document.createElement('button')
    button.dataset.action = 'skip'

    const pending = dispatchAction(button, clickEvent())
    assert.equal(button.disabled, true)

    answer.resolve({})
    await pending
    await flush()
    assert.equal(button.disabled, false)
    panel.route('POST /api/player/skip', {})
  })

  await t.test('an action that is over at once does not touch the button', () => {
    document.body.insertAdjacentHTML('beforeend', '<div class="row-menu"><button type="button" id="menuToggle" data-action="toggle-menu"></button><div class="row-menu-dropdown hidden"></div></div>')
    const button = document.getElementById('menuToggle')

    dispatchAction(button, new window.MouseEvent('click', { detail: 1 }))

    assert.equal(button.disabled, false)
  })

  await t.test('an action that fails is reported by the dispatcher, and the button is usable again', async () => {
    panel.route('POST /api/player/skip', [500, { error: 'raw', code: 'SERVER_ERROR' }])
    document.getElementById('toastContainer').innerHTML = ''
    const button = document.createElement('button')
    button.dataset.action = 'skip'

    await dispatchAction(button, clickEvent())
    await flush()

    assert.ok(panel.toasts().includes('Internal server error'))
    assert.equal(button.disabled, false)
    panel.route('POST /api/player/skip', {})
  })

  await t.test('an action that throws at once is reported too, as something that went wrong', async () => {
    ACTIONS.explode = () => {
      throw new Error('boom')
    }
    document.getElementById('toastContainer').innerHTML = ''
    const button = document.createElement('button')
    button.dataset.action = 'explode'

    await dispatchAction(button, clickEvent())

    assert.ok(panel.toasts().includes('Something went wrong, see the log for details'))
    delete ACTIONS.explode
  })

  await t.test('an action nobody handles is logged and does nothing', () => {
    const button = document.createElement('button')
    button.dataset.action = 'no-such-action'
    panel.calls.length = 0

    assert.equal(dispatchAction(button, new window.Event('click')), undefined)
    assert.deepEqual(panel.calls, [])
  })
})

test('the actions of the page', async (t) => {
  await t.test('the buttons that destroy something ask first, in words that both languages have', () => {
    views.playlists.render([{ id: 'PL1', title: 'List', thumbnail: '', itemCount: 1, isActive: false }])
    const asking = [...['clear-queue', 'clear-activity', 'disconnect-twitch'].map((name) => panel.$(`[data-action="${name}"]`)), panel.$('[data-action="playlist-delete"]')]

    for (const button of asking) {
      assert.ok(button?.dataset.confirm, `${button?.dataset.action} has no data-confirm`)
      assert.notEqual(translate(button.dataset.confirm), button.dataset.confirm, `no text for ${button.dataset.confirm}`)
    }
  })

  await t.test('every data-action in index.html has a handler', () => {
    const named = panel.$$('[data-action]').map((element) => element.dataset.action)

    assert.deepEqual([...new Set(named)].filter((name) => !(name in ACTIONS)), [])
  })

  await t.test('every registered action is used by the page or the views, and every handler is a function', () => {
    const code = sources(CONTROL_DIR).join('\n')
    const used = new Set([
      ...panel.$$('[data-action]').map((element) => element.dataset.action),
      ...[...code.matchAll(/data-action="([\w-]+)"/g), ...code.matchAll(/\baction: '([\w-]+)'/g)].map((match) => match[1])
    ])

    assert.deepEqual(Object.keys(ACTIONS).filter((name) => !used.has(name)), [])
    assert.deepEqual(Object.entries(ACTIONS).filter(([, handler]) => typeof handler !== 'function').map(([name]) => name), [])
  })

  await t.test('every action that the views put on their rows and buttons has a handler', () => {
    const code = sources(CONTROL_DIR).join('\n')
    const named = [...code.matchAll(/data-action="([\w-]+)"/g), ...code.matchAll(/\baction: '([\w-]+)'/g)].map((match) => match[1])

    assert.ok(named.length >= 8, `found only ${named.length} actions in the views`)
    assert.deepEqual([...new Set(named)].filter((name) => !(name in ACTIONS)), [])
  })
})
