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
// was filled, and sending them back would put the old values over the new ones
export function readForm(form, { changedOnly = false } = {}) {
  const body = {}

  for (const input of formInputs(form)) {
    if (changedOnly && !isChanged(input)) continue

    const keys = input.name.split('.')
    const last = keys.pop()
    const target = keys.reduce((object, key) => (object[key] ??= {}), body)
    target[last] = valueOf(input)
  }

  return body
}

// `skip`: names to leave as they are (the ones the server refused keep what was typed). A name the stored object has no value for is left alone
export function fillForm(form, config, { skip = [] } = {}) {
  for (const input of formInputs(form)) {
    const value = get(config, input.name)
    if (skip.includes(input.name) || value === undefined) continue

    if (input.type === 'checkbox') {
      input.checked = input.defaultChecked = Boolean(value)
    } else if (input.tagName === 'SELECT') {
      input.value = String(value ?? '')
      for (const option of input.options) option.defaultSelected = option.value === input.value
    } else {
      input.value = input.defaultValue = String(value ?? '')
    }

    setFieldState(input, null)
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

/**
 * Sends the form with `save(body)` (all its fields, or the changed ones with `changedOnly`), which answers { config, rejected },
 * then shows the stored values and marks the fields:
 * refused -> red (and keeps what was typed), stored with a new value -> green, the rest plain.
 * Returns { config, rejected, saved, refused } for toastSaveResult
 */
export async function saveForm(form, save, { changedOnly = false } = {}) {
  const inputs = formInputs(form)
  const changed = new Map(inputs.map((input) => [input, isChanged(input)]))
  const sent = new Map(inputs.map((input) => [input, valueOf(input)]))
  const { config, rejected } = await save(readForm(form, { changedOnly }))
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
