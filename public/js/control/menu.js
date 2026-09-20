export function closeAllMenus({ restoreFocus = false } = {}) {
  document.querySelectorAll('.row-menu').forEach((menu) => {
    const dropdown = menu.querySelector('.row-menu-dropdown')
    const toggle = menu.querySelector('[data-action="toggle-menu"]')
    const wasOpen = dropdown && !dropdown.classList.contains('hidden')

    dropdown?.classList.add('hidden')
    toggle?.setAttribute('aria-expanded', 'false')

    if (wasOpen && restoreFocus) toggle?.focus()
  })
}

export function toggleMenu(toggle, event) {
  const dropdown = toggle.closest('.row-menu')?.querySelector('.row-menu-dropdown')
  const wasOpen = dropdown && !dropdown.classList.contains('hidden')

  closeAllMenus()
  if (!dropdown || wasOpen) return

  dropdown.classList.remove('hidden')
  toggle.setAttribute('aria-expanded', 'true')

  // keyboard activation (Enter/Space give detail === 0): move focus into the menu
  if (event?.detail === 0) dropdown.querySelector('[role="menuitem"]')?.focus()
}

export const menuActions = {
  'toggle-menu': toggleMenu
}

export function bindMenus() {
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="toggle-menu"]')) return
    closeAllMenus()
  })

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAllMenus({ restoreFocus: true })
  })
}
