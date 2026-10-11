import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setupPanel } from './panel-env.js'

setupPanel()
document.body.insertAdjacentHTML(
  'beforeend',
  ['a', 'b']
    .map(
      (id) => `<div class="row-menu" id="menu-${id}">
        <button type="button" id="toggle-${id}" data-action="toggle-menu" aria-expanded="false"></button>
        <div class="row-menu-dropdown hidden"><button type="button" role="menuitem" id="item-${id}">item</button></div>
      </div>`
    )
    .join('')
)

const { toggleMenu, closeAllMenus, bindMenus } = await import('../../../public/js/control/menu.js')
bindMenus()

const toggle = (id) => document.getElementById(`toggle-${id}`)
const isOpen = (id) => !document.querySelector(`#menu-${id} .row-menu-dropdown`).classList.contains('hidden')
const click = (element, init) => element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, ...init }))

test('menus', async (t) => {
  t.beforeEach(() => closeAllMenus())

  await t.test('a toggle opens its menu and says so to assistive technology, a second one closes it', () => {
    toggleMenu(toggle('a'), { detail: 1 })
    assert.equal(isOpen('a'), true)
    assert.equal(toggle('a').getAttribute('aria-expanded'), 'true')

    toggleMenu(toggle('a'), { detail: 1 })
    assert.equal(isOpen('a'), false)
    assert.equal(toggle('a').getAttribute('aria-expanded'), 'false')
  })

  await t.test('only one menu is open at a time', () => {
    toggleMenu(toggle('a'), { detail: 1 })
    toggleMenu(toggle('b'), { detail: 1 })

    assert.equal(isOpen('a'), false)
    assert.equal(toggle('a').getAttribute('aria-expanded'), 'false')
    assert.equal(isOpen('b'), true)
  })

  await t.test('opened from the keyboard (Enter or Space), the focus moves into the menu; opened by a click, it stays', () => {
    toggle('a').focus()
    toggleMenu(toggle('a'), { detail: 1 })
    assert.equal(document.activeElement, toggle('a'))

    closeAllMenus()
    toggleMenu(toggle('a'), { detail: 0 })
    assert.equal(document.activeElement, document.getElementById('item-a'))
  })

  await t.test('Escape closes the menu and gives the focus back to its toggle', () => {
    toggleMenu(toggle('a'), { detail: 0 })

    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    assert.equal(isOpen('a'), false)
    assert.equal(document.activeElement, toggle('a'))
  })

  await t.test('Escape with nothing open leaves the focus where it is', () => {
    toggle('b').focus()

    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    assert.equal(document.activeElement, toggle('b'))
  })

  await t.test('a click anywhere else closes the menu, a click on a toggle is left to the toggle', () => {
    toggleMenu(toggle('a'), { detail: 1 })

    click(toggle('a'))
    assert.equal(isOpen('a'), true)

    click(document.body)
    assert.equal(isOpen('a'), false)
  })
})
