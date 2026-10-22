let save: (() => void) | null = null

// Bound by initState() once the saved state is loaded: a change made before that must not overwrite the file
export function bindStatePersistence(fn: () => void): void {
  save = fn
}

export function requestStateSave(): void {
  save?.()
}
