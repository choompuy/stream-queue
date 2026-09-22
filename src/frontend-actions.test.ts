import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url))
const CONTROL_DIR = join(PUBLIC_DIR, 'js', 'control')

// The control panel modules touch `document` while being imported. A do-nothing stub is enough
// to load the real action registry without a browser.
const noopNode = () => ({
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  addEventListener() {},
  setAttribute() {},
  querySelector: () => null,
  querySelectorAll: () => [],
  dataset: {}
})
const g = globalThis as any
g.window = g
g.document = {
  getElementById: () => null,
  createElement: noopNode,
  head: { appendChild() {} },
  documentElement: { lang: 'en' },
  querySelectorAll: () => [],
  addEventListener() {}
}

const { ACTIONS, createActionRegistry } = (await import(pathToFileURL(join(CONTROL_DIR, 'actions.js')).href)) as {
  ACTIONS: Record<string, unknown>
  createActionRegistry: (...maps: Array<Record<string, unknown>>) => Record<string, unknown>
}

function jsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return jsFiles(path)
    return entry.name.endsWith('.js') && !entry.name.endsWith('.test.js') ? [path] : []
  })
}

function referencedActions(): Set<string> {
  const files = [join(PUBLIC_DIR, 'index.html'), ...jsFiles(CONTROL_DIR)]
  const found = new Set<string>()

  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    // data-action="name" in markup and template strings
    for (const match of text.matchAll(/data-action="([a-z][a-z-]*)"/g)) found.add(match[1])
    // { action: 'name' } menu item definitions
    for (const match of text.matchAll(/\baction:\s*'([a-z][a-z-]*)'/g)) found.add(match[1])
  }

  return found
}

test('control panel actions', async (t) => {
  await t.test('every data-action used in the markup or views has a registered handler', () => {
    const missing = [...referencedActions()].filter((name) => !(name in ACTIONS))
    assert.deepEqual(missing, [], `no handler registered for: ${missing.join(', ')}`)
  })

  await t.test('every registered handler is referenced from the markup or views (no dead actions)', () => {
    const referenced = referencedActions()
    const dead = Object.keys(ACTIONS).filter((name) => !referenced.has(name))
    assert.deepEqual(dead, [], `registered but never used: ${dead.join(', ')}`)
  })

  await t.test('all handlers are functions', () => {
    for (const [name, handler] of Object.entries(ACTIONS)) {
      assert.equal(typeof handler, 'function', `${name} is not a function`)
    }
  })

  await t.test('registering the same action name twice throws', () => {
    assert.throws(() => createActionRegistry({ same: () => {} }, { same: () => {} }), /Duplicate UI action "same"/)
  })
})
