import { getState, moveToNext } from './player.js'
import { refreshFallback } from './fallback.js'
import { createLogger, describeError } from './logger.js'

const log = createLogger('SERVER')

function startPlaybackIfIdle(): void {
  try {
    if (!getState().current) moveToNext()
  } catch (error) {
    log.error(`Could not start playback at startup: ${describeError(error)}`)
  }
}

export async function runStartupTasks(): Promise<void> {
  // the restored queue (or the restored rotation of the fallback playlist) plays at once: it must not wait for the network
  startPlaybackIfIdle()

  try {
    await refreshFallback()
  } catch (error) {
    log.warn(`The fallback playlist could not be loaded at startup: ${describeError(error)}`)
  }

  // nothing was restored: the freshly loaded playlist can start now
  startPlaybackIfIdle()
}
