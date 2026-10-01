import { api } from './api.js'
import { state } from './state.js'
import { run } from './run.js'
import { refreshState } from './queue.js'

export function playPauseCurrent() {
  return run('toggling resume/pause', async () => {
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
  'resume-pause': playPauseCurrent,
  skip: skipCurrent
}
