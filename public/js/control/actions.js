import { log } from './state.js'
import { playerActions } from './player-actions.js'
import { searchActions } from './search.js'
import { queueActions } from './queue.js'
import { fallbackActions } from './fallback-actions.js'
import { activityActions } from './activity.js'
import { blocklistActions } from './blocklist.js'
import { playlistActions } from './playlists.js'
import { settingsActions } from './settings.js'
import { menuActions } from './menu.js'

export function createActionRegistry(...maps) {
  const registry = Object.create(null)

  for (const map of maps) {
    for (const [name, handler] of Object.entries(map)) {
      if (name in registry) throw new Error(`Duplicate UI action "${name}"`)
      registry[name] = handler
    }
  }

  return registry
}

export const ACTIONS = createActionRegistry(
  playerActions,
  searchActions,
  queueActions,
  fallbackActions,
  activityActions,
  blocklistActions,
  playlistActions,
  settingsActions,
  menuActions
)

export function dispatchAction(element, event) {
  const name = element.dataset.action
  const handler = ACTIONS[name]

  if (!handler) {
    log(`No handler registered for action "${name}"`)
    return undefined
  }

  return handler(element, event)
}
