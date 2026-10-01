import { searchView } from './search.js'
import { queueView } from './queue.js'
import { fallbackView } from './fallback.js'
import { activityView } from './activity.js'
import { blocklistView } from './blocklist.js'
import { playlistsView } from './playlists.js'

export const views = {
  search: searchView,
  queue: queueView,
  fallback: fallbackView,
  activity: activityView,
  blocklist: blocklistView,
  playlists: playlistsView
}
