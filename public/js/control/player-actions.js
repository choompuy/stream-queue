import { api } from './api.js'
import { state } from './state.js'
import { run } from './run.js'
import { refreshState } from './queue.js'

export function playPauseCurrent() {
  return run('toggling play/pause', async () => {
    if (state.isPaused) await api.resume()
    else await api.pause()

    await refreshState()
  })
}

export function skipCurrent() {
  return run('skipping', async () => {
    await api.skip()
    await refreshState()
  })
}

export const playerActions = {
  'play-pause': playPauseCurrent,
  skip: skipCurrent
}
