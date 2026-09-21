import { getState, moveToNext } from './player.js'
import { refreshFallback } from './fallback.js'

export async function runStartupTasks(): Promise<void> {
  try {
    await refreshFallback()
  } catch (error) {
    console.warn(`[SERVER] The fallback playlist could not be loaded at startup: ${error instanceof Error ? error.message : error}`)
  }

  try {
    if (!getState().current) moveToNext()
  } catch (error) {
    console.error('[SERVER] Could not start playback at startup:', error instanceof Error ? error.message : error)
  }
}
