import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setupPanel } from './panel-env.js'

setupPanel()

const { dom } = await import('../../../public/js/control/dom.js')

// counts what is asked of the page while `work` runs
function lookups(work) {
  const original = document.getElementById
  let count = 0
  document.getElementById = (id) => {
    count++
    return original.call(document, id)
  }

  try {
    work()
  } finally {
    document.getElementById = original
  }

  return count
}

test('dom', async (t) => {
  await t.test('an element is looked up once, however often it is used', () => {
    assert.equal(
      lookups(() => {
        for (let index = 0; index < 5; index++) dom.queueCount
      }),
      1
    )
  })

  await t.test('an element that was replaced on the page is found again', () => {
    const before = dom.queueCount
    const replacement = document.createElement('span')
    replacement.id = 'queueCount'
    before.replaceWith(replacement)

    assert.equal(dom.queueCount, replacement)
  })

  await t.test('an id that is not on the page gives null every time, and is looked for every time', () => {
    assert.equal(
      lookups(() => {
        assert.equal(dom.noSuchElement, null)
        assert.equal(dom.noSuchElement, null)
      }),
      2
    )
  })
})
