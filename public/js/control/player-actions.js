import { api } from './api.js'
import { state } from './state.js'

export function playPauseCurrent() {
  return state.isPaused ? api.resume() : api.pause()
}

export function skipCurrent() {
  return api.skip()
}

export const playerActions = {
  'resume-pause': playPauseCurrent,
  skip: skipCurrent
}
