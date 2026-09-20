type Listener = () => void

const listeners: Listener[] = []

export function onStateChange(listener: Listener): void {
  listeners.push(listener)
}

export function notifyStateChange(): void {
  for (const listener of listeners) listener()
}
