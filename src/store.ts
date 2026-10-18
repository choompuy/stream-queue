import { isDeepStrictEqual } from 'node:util'
import { emit, type Topic } from './state-events.js'

type StoreOptions<T> = {
  read: () => T
  topics: readonly Topic[]
  save?: () => void
}

// update(fn) is the one way to change what a module keeps: the state is compared before and after, and a
// change saves once and announces the topics once. A mutation that changed nothing stays silent
export function createStore<T>(options: StoreOptions<T>) {
  const { read, topics, save } = options

  function update(mutate: () => void): void {
    const before = structuredClone(read())
    mutate()
    if (isDeepStrictEqual(before, structuredClone(read()))) return
    save?.()
    for (const topic of topics) emit(topic)
  }

  // a change that is not in the state itself but in what depends on it: re-read only, nothing to save
  function announce(): void {
    for (const topic of topics) emit(topic)
  }

  return { update, announce }
}
