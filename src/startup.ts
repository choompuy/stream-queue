import { getState, moveToNext } from './player.js'
import { refreshFallback } from './fallback.js'
import { createLogger, describeError } from './logger.js'

const log = createLogger('SERVER')

export async function runStartupTasks(): Promise<void> {
  try {
    await refreshFallback()
  } catch (error) {
    log.warn(`The fallback playlist could not be loaded at startup: ${describeError(error)}`)
  }

  try {
    if (!getState().current) moveToNext()
  } catch (error) {
    log.error(`Could not start playback at startup: ${describeError(error)}`)
  }
}
