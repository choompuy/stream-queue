import { t } from '../i18n.js'
import { log } from './log.js'
import { playerActions } from './player-actions.js'
import { searchActions } from './search.js'
import { queueActions } from './queue.js'
import { fallbackActions } from './fallback-actions.js'
import { activityActions } from './activity.js'
import { blocklistActions } from './blocklist.js'
import { playlistActions } from './playlists.js'
import { settingsActions } from './settings.js'
import { twitchActions } from './twitch/index.js'
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
  twitchActions,
  menuActions
)

// Every button of the panel goes through here, so what all of them share is done once:
// a button with data-confirm asks first, and a button whose action takes time stays disabled until the action is over
export function dispatchAction(element, event) {
  const name = element.dataset.action
  const handler = ACTIONS[name]

  if (!handler) {
    log(`No handler registered for action "${name}"`)
    return undefined
  }

  if (element.dataset.confirm && !confirm(t(element.dataset.confirm))) return undefined

  const result = handler(element, event)

  if (typeof result?.then === 'function' && 'disabled' in element) {
    element.disabled = true
    const enable = () => {
      element.disabled = false
    }
    result.then(enable, enable)
  }

  return result
}
