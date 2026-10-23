import { log } from './log.js'

/**
 * A store the panel draws from. Assigning a slice (`state.queue = …`) collects every slice that changed and calls
 * their subscribers once, in a single microtask: one read that changes five slices draws everything once, however
 * many subscribers those slices have, and a subscriber of two slices is not called twice for a change of both.
 *
 * A slice is assigned whole. Writing into one of its fields (`state.twitch.health = …`) is not seen: whoever changes
 * a part of a slice assigns the slice (`state.twitch = { ...state.twitch, health }`), which is what patch() does.
 *
 * A drawing that fails does not stop the others: the failure is logged, and the rest of the drawings still run.
 */
export function createStore(initial) {
  const subs = new Map()
  let queued = new Set()
  let flushing = false

  // writes that arrive while the subscribers run are flushed again: nobody misses its own change
  const call = (fn) => {
    try {
      fn()
    } catch (error) {
      log('A drawing failed:', error)
    }
  }

  const flush = () => {
    if (flushing) return
    flushing = true
    try {
      while (queued.size) {
        const changed = queued
        queued = new Set()
        const fns = new Set()
        changed.forEach((key) => subs.get(key)?.forEach((fn) => fns.add(fn)))
        fns.forEach(call)
      }
    } finally {
      flushing = false
    }
  }

  const state = new Proxy(initial, {
    set(target, key, value) {
      target[key] = value
      if (!queued.size) queueMicrotask(flush)
      queued.add(key)
      return true
    }
  })

  // on('queue', draw) or on(['queue', 'config'], draw): the drawing runs when any of its slices changes
  const on = (keys, fn) => {
    for (const key of [].concat(keys)) subs.set(key, [...(subs.get(key) ?? []), fn])
  }

  // every drawing runs once, whatever it follows: the language of the page changed, and every drawing reads it
  const refresh = () => {
    const fns = new Set()
    subs.forEach((list) => list.forEach((fn) => fns.add(fn)))
    fns.forEach(call)
  }

  // changes a part of a slice by assigning the slice whole, which the subscribers can see
  const patch = (key, part) => {
    state[key] = { ...state[key], ...part }
  }

  return { state, on, refresh, patch }
}
