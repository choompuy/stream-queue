import { getState, moveToNext } from './core/player/service.js'
import { refreshFallback } from './core/playlists/fallback.js'
import { initializeTwitchIntegration } from './integrations/twitch/index.js'
import { getConfig } from './config/index.js'

export async function runStartupTasks(port: number): Promise<void> {
  // Initialize Twitch integration
  try {
    const config = getConfig()
    initializeTwitchIntegration({
      clientId: config.twitch.clientId || process.env.TWITCH_CLIENT_ID,
      clientSecret: config.twitch.clientSecret || process.env.TWITCH_CLIENT_SECRET,
      redirectUri: `http://localhost:${port}/api/integrations/twitch/callback`
    })
  } catch (error) {
    console.warn(`[SERVER] Twitch integration initialization failed: ${error instanceof Error ? error.message : error}`)
  }

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
