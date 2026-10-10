import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setupPanel } from './panel-env.js'

const panel = setupPanel()
mock.method(console, 'log', () => {})

const { initI18n } = await import('../../../public/js/i18n.js')
await initI18n('en')
const { createActionRegistry, dispatchAction, ACTIONS } = await import('../../../public/js/control/actions.js')

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

    assert.deepEqual(panel.calls, ['POST /api/player/skip', 'GET /api/state'])
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
  await t.test('every data-action in index.html has a handler', () => {
    const named = panel.$$('[data-action]').map((element) => element.dataset.action)

    assert.deepEqual([...new Set(named)].filter((name) => !(name in ACTIONS)), [])
  })

  await t.test('every action that the views put on their rows and buttons has a handler', () => {
    const code = sources(CONTROL_DIR).join('\n')
    const named = [...code.matchAll(/data-action="([\w-]+)"/g), ...code.matchAll(/\baction: '([\w-]+)'/g)].map((match) => match[1])

    assert.ok(named.length >= 8, `found only ${named.length} actions in the views`)
    assert.deepEqual([...new Set(named)].filter((name) => !(name in ACTIONS)), [])
  })
})
