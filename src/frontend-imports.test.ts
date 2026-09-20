import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const CONTROL_DIR = fileURLToPath(new URL('../public/js/control/', import.meta.url))

function jsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return jsFiles(path)
    return entry.name.endsWith('.js') ? [path] : []
  })
}

function importGraph(): Map<string, string[]> {
  const files = new Set(jsFiles(CONTROL_DIR))
  const graph = new Map<string, string[]>()

  for (const file of files) {
    const deps: string[] = []
    for (const match of readFileSync(file, 'utf8').matchAll(/from\s+'(\.[^']+)'/g)) {
      const target = normalize(join(dirname(file), match[1]))
      if (files.has(target)) deps.push(target)
    }
    graph.set(file, deps)
  }

  return graph
}

function findCycle(graph: Map<string, string[]>): string[] | null {
  const state = new Map<string, 'visiting' | 'done'>()

  function visit(node: string, path: string[]): string[] | null {
    if (state.get(node) === 'done') return null
    if (state.get(node) === 'visiting') return [...path.slice(path.indexOf(node)), node]

    state.set(node, 'visiting')
    for (const dep of graph.get(node) ?? []) {
      const cycle = visit(dep, [...path, node])
      if (cycle) return cycle
    }
    state.set(node, 'done')
    return null
  }

  for (const node of graph.keys()) {
    const cycle = visit(node, [])
    if (cycle) return cycle
  }
  return null
}

test('control panel modules have no circular imports', () => {
  const cycle = findCycle(importGraph())
  const readable = cycle?.map((file) => file.replace(CONTROL_DIR, '')).join(' -> ')
  assert.equal(cycle, null, `import cycle: ${readable}`)
})
