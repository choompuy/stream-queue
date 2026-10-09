import { setText } from '../shared.js'
import { state } from './state.js'
import { dom } from './dom.js'

// the counters on the tabs of the dashboard
export function renderStats() {
  setText(dom.tabPlaylistCount, state.fallback?.sourceCount ?? 0)
  setText(dom.tabActivityCount, state.activity.length)
  setText(dom.tabBlocklistCount, state.blocklist.length)
}
