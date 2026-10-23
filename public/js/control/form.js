import { setFieldState } from '../shared.js'
import { t } from '../i18n.js'
import { toastError, toastSuccess } from './toast.js'

/**
 * One engine for every settings form. A form is an element with inputs that have a `name`:
 * the path of the value in the object that the server stores for it ("minViews", "chatCommands.skip.command").
 *   readForm(form) is the body to send,
 *   fillForm(form, config) puts the stored object into the inputs, and
 *   the server answers { config, rejected } with the names it refused.
 * What an input held when it was filled is kept by the input itself (defaultValue, defaultChecked), and "changed" is a difference from it
 */

const get = (object, path) => path.split('.').reduce((value, key) => value?.[key], object)

export const formInputs = (form) => [...form.querySelectorAll('[name]')]

const valueOf = (input) => {
  if (input.type === 'checkbox') return input.checked
  if (input.type === 'number') return input.value === '' ? null : Number(input.value)
  return input.value.trim()
}

const defaultOf = (input) => {
  if (input.type === 'checkbox') return input.defaultChecked
  if (input.type === 'number') return input.defaultValue === '' ? null : Number(input.defaultValue)
  if (input.tagName === 'SELECT') return ([...input.options].find((option) => option.defaultSelected) ?? input.options[0])?.value ?? ''
  return input.defaultValue.trim()
}

export const isChanged = (input) => valueOf(input) !== defaultOf(input)

// `changedOnly`: only the inputs that differ from what was stored. Another panel may have changed the others since this one
// was filled, and sending them back would put the old values over the new ones.
// `groups`: paths whose fields belong together — when one of them changes, the group is sent whole (a limit of a
// reward is its switch and its number: the server takes them as a pair, and half a pair is a refusal)
export function readForm(form, { changedOnly = false, groups = [] } = {}) {
  const changedGroups = new Set(
    changedOnly
      ? formInputs(form)
          .filter(isChanged)
          .map((input) => groups.find((prefix) => input.name.startsWith(`${prefix}.`)))
          .filter(Boolean)
      : []
  )

  const body = {}

  for (const input of formInputs(form)) {
    const group = groups.find((prefix) => input.name.startsWith(`${prefix}.`))
    if (changedOnly && !isChanged(input) && !(group && changedGroups.has(group))) continue

    const keys = input.name.split('.')
    const last = keys.pop()
    const target = keys.reduce((object, key) => (object[key] ??= {}), body)
    target[last] = valueOf(input)
  }

  return body
}

// `skip`: names to leave as they are (the ones the server refused keep what was typed). A name the stored object has no value for is left alone
// `keepMarks`: for a fill of a form with what it already shows (the echo of a save): a field keeps its mark instead of
// losing it, but only while the fill brings the same value it holds
export function fillForm(form, config, { skip = [], keepMarks = false } = {}) {
  for (const input of formInputs(form)) {
    const value = get(config, input.name)
    if (skip.includes(input.name) || value === undefined) continue

    const next = input.type === 'checkbox' ? Boolean(value) : String(value ?? '')
    const shown = input.type === 'checkbox' ? input.checked : input.value
    if (!(keepMarks && shown === next)) setFieldState(input, null)

    if (input.type === 'checkbox') {
      input.checked = input.defaultChecked = next
    } else if (input.tagName === 'SELECT') {
      input.value = next
      for (const option of input.options) option.defaultSelected = option.value === next
    } else {
      input.value = input.defaultValue = next
    }
  }

  syncEnables(form)
}

// A checkbox with data-enables="<id of an input>" switches that input on and off: while it is off, the input is locked.
function syncEnables(form) {
  for (const toggle of form.querySelectorAll('[data-enables]')) document.getElementById(toggle.dataset.enables).disabled = !toggle.checked
}

// yellow while an input differs from what was stored, plain again as soon as it matches
export function markChanged(input) {
  setFieldState(input, isChanged(input) ? 'changed' : null)
}

// marks the inputs of the form as they change; one listener for the whole form
export function trackForm(form) {
  const update = (event) => {
    if (event.target.name) markChanged(event.target)
  }

  for (const type of ['input', 'change', 'focusin']) form.addEventListener(type, update)

  // turning a switch off locks its input and empties it
  form.addEventListener('change', ({ target }) => {
    if (!target.dataset.enables) return

    const input = document.getElementById(target.dataset.enables)
    input.disabled = !target.checked
    if (!target.checked && input.type !== 'checkbox') input.value = ''
    markChanged(input)
  })
}

// The stored values go into a form, except the fields the person is editing right now — their answer would be older
// than what was typed since. A mark survives a fill that brings the same value the field holds (the echo of a save)
export function fillFormKeepingEdits(form, config) {
  const editing = formInputs(form)
    .filter(isChanged)
    .map((input) => input.name)
  fillForm(form, config, { skip: editing, keepMarks: true })
}

/**
 * Sends the form with `save(body)` (all its fields, or the changed ones with `changedOnly`), which answers { config, rejected },
 * then shows the stored values and marks the fields:
 * refused -> red (and keeps what was typed), stored with a new value -> green, the rest plain.
 * Returns { config, rejected, saved, refused } for toastSaveResult
 */
export async function saveForm(form, save, { changedOnly = false, groups = [] } = {}) {
  const inputs = formInputs(form)
  const changed = new Map(inputs.map((input) => [input, isChanged(input)]))
  const sent = new Map(inputs.map((input) => [input, valueOf(input)]))
  const { config, rejected } = await save(readForm(form, { changedOnly, groups }))
  let saved = 0
  let refused = 0

  // what was typed while the request was on its way stays as typed: the answer is older than that
  const edited = inputs.filter((input) => valueOf(input) !== sent.get(input))

  fillForm(form, config, { skip: [...rejected, ...edited.map((input) => input.name)] })

  for (const [input, wasChanged] of changed) {
    const isRefused = rejected.includes(input.name)

    if (isRefused) refused++
    else if (wasChanged) saved++

    if (isRefused || wasChanged) setFieldState(input, isRefused ? 'error' : 'saved')
  }

  edited.forEach(markChanged)

  return { config, rejected, saved, refused }
}

// one green toast, or the count of what was and was not stored; `successToast: false` is for a caller that has shown its own, worse news
export function toastSaveResult({ saved, refused }, successKey, { successToast = true } = {}) {
  if (refused > 0) toastError(t('toast.settingsPartiallySaved', { saved, rejected: refused }))
  else if (successToast) toastSuccess(t(successKey))
}

/**
 * A settings panel with a Save and a Cancel, the way the settings pages are built. The topic that owns the data
 * fills the form through `fill` (the fields the person is editing keep what was typed), `save(body)` sends what
 * changed and answers { config, rejected }, and `stored()` is the object the Cancel returns to (a panel without
 * a Cancel, one that saves itself as it changes, leaves it out).
 */
export function defineFormPanel(form, { save, stored = null, toastKey }) {
  return {
    fill: (config) => fillFormKeepingEdits(form, config),

    // only the changed fields: another panel may have changed the rest since this one was filled
    saveChanges: () => saveForm(form, save, { changedOnly: true }),

    // back to what is stored: the marks go with it
    cancel: () => {
      const config = stored?.()
      if (config != null) fillForm(form, config)
    },

    toastResult: (result, options = {}) => toastSaveResult(result, toastKey, options)
  }
}
