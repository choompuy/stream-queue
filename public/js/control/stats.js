import { setText } from '../shared.js'
import { state, on } from './state.js'
import { dom } from './dom.js'

// the counters on the tabs of the dashboard follow the three lists they count
on(['fallback', 'activity', 'blocklist'], renderStats)

export function renderStats() {
  setText(dom.tabPlaylistCount, state.fallback?.sourceCount ?? 0)
  setText(dom.tabActivityCount, state.activity.length)
  setText(dom.tabBlocklistCount, state.blocklist.length)
}
