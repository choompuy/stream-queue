import { api } from './api.js'
import { state } from './state.js'
import { run } from './run.js'

export function playPauseCurrent() {
  return run('toggling resume/pause', () => (state.isPaused ? api.resume() : api.pause()))
}

export function skipCurrent() {
  return run('skipping', () => api.skip())
}

export const playerActions = {
  'resume-pause': playPauseCurrent,
  skip: skipCurrent
}
